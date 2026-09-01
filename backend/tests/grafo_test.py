"""Compara el pipeline RAG con grafo (LangGraph, con reevaluacion y
reescritura de consulta) frente al pipeline "baseline" de una sola pasada
que existia antes de introducir el grafo, sobre las mismas 25 preguntas de
tests/response_file.json.

No es un test de pytest: hace llamadas reales al LLM (Gemini, version
gratuita con limite de peticiones por minuto) y a Qdrant, asi que se
ejecuta como script.

Para cada pregunta se ejecutan dos pipelines con el mismo modelo final:
  - baseline: reformular_consulta -> search_chunks -> generate_query -> LLM
    (una sola pasada, sin reevaluacion ni reescritura).
  - grafo: grafo.invoke(...) (incluye nodo_evaluar / nodo_reescribir, hasta
    2 reintentos de busqueda si el contexto tiene puntuacion pobre) -> LLM.

Se mide, para cada pipeline: si el documento esperado aparece entre los
recuperados, si la respuesta es semanticamente equivalente a la esperada
(similitud coseno de embeddings, no coincidencia literal: un LLM puede
parafrasear una respuesta correcta) -- o, para las preguntas de tipo
"ausente"/"trampa", si el modelo admite que no encuentra la informacion --,
la puntuacion media de retrieval y la duracion. La coincidencia literal con
"debe_contener" se guarda solo como columna informativa, no decide el
acierto.

Uso:
    uv run python tests/grafo_test.py
    uv run python tests/grafo_test.py --pausa 3
    uv run python tests/grafo_test.py --preguntas tests/response_file_dificil.json
"""

import argparse
import json
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import litellm
import numpy as np
import pandas as pd
from fastembed import SparseTextEmbedding, TextEmbedding
from fastembed.rerank.cross_encoder import TextCrossEncoder
from qdrant_client import QdrantClient

from app.core.config import get_settings
from app.rag.grafo.grafo_create import crear_grafo
from app.rag.prompt import generate_query, reformular_consulta
from app.rag.retrieval import search_chunks

DEFAULT_PAUSE = 4.0  # version gratuita de Gemini: limite de peticiones/min
DEFAULT_SIMILARITY_THRESHOLD = 0.85
RETRIES = 4
TESTS_DIR = Path(__file__).parent
QUESTIONS_PATH = TESTS_DIR / "response_file.json"
RESULTS_DIR = TESTS_DIR / "results"
ABSENT_PHRASE = "no encuentro esa informacion"
TIPOS_SIN_RESPUESTA = {"ausente", "trampa"}


def normalize(text: str | None) -> str:
    if not text:
        return ""
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def llm_complete(messages: list[dict], model: str) -> str:
    last_error = None
    for attempt in range(RETRIES):
        try:
            respuesta = litellm.completion(model=model, messages=messages)
            return respuesta.choices[0].message.content.strip()
        except Exception as exc:
            last_error = exc
            if attempt < RETRIES - 1:
                time.sleep(5 * (2 ** attempt))  # 5s, 10s, 20s
    raise last_error


def evaluar(item: dict, respuesta: str, documentos_recuperados: list[str], dense_embedder, umbral: float) -> dict:
    if item["tipo"] in TIPOS_SIN_RESPUESTA:
        return {
            "respuesta_correcta": ABSENT_PHRASE in normalize(respuesta),
            "similitud": None,
            "contiene_keyword": None,
            "doc_recuperado_ok": None,
        }

    vectores = np.array(list(dense_embedder.embed([f"query: {respuesta}", f"query: {item['respuesta_esperada']}"])))
    similitud = round(cosine_similarity(vectores[0], vectores[1]), 3)
    return {
        "respuesta_correcta": similitud >= umbral,
        "similitud": similitud,
        "contiene_keyword": normalize(item["debe_contener"]) in normalize(respuesta),
        "doc_recuperado_ok": item["documento_esperado"] in documentos_recuperados,
    }


def run_baseline(item: dict, dense_embedder, sparse_embedder, cross_encoder, qdrant, model: str, pausa: float, umbral: float) -> dict:
    t0 = time.perf_counter()
    consulta = reformular_consulta(item["pregunta"], [], model)
    chunks = search_chunks(consulta, dense_embedder, sparse_embedder, qdrant, cross_encoder)
    messages = generate_query(item["pregunta"], chunks, [])
    respuesta = llm_complete(messages, model)
    duracion = round(time.perf_counter() - t0, 2)
    time.sleep(pausa)

    documentos = [c["nombre"] for c in chunks]
    score_medio = round(sum(c["score"] for c in chunks) / len(chunks), 3) if chunks else None
    return {
        "pipeline": "baseline",
        "respuesta": respuesta,
        "documentos_recuperados": documentos,
        "score_medio_retrieval": score_medio,
        "reintentos": 0,
        "duracion_seg": duracion,
        **evaluar(item, respuesta, documentos, dense_embedder, umbral),
    }


def run_grafo(item: dict, grafo, dense_embedder, model: str, pausa: float, umbral: float) -> dict:
    t0 = time.perf_counter()
    estado = grafo.invoke({"query": item["pregunta"], "historial": []})
    chunks = estado.get("chunks", [])
    respuesta = llm_complete(estado["messages"], model)
    duracion = round(time.perf_counter() - t0, 2)
    time.sleep(pausa)

    documentos = [c["nombre"] for c in chunks]
    score_medio = round(sum(c["score"] for c in chunks) / len(chunks), 3) if chunks else None
    return {
        "pipeline": "grafo",
        "respuesta": respuesta,
        "documentos_recuperados": documentos,
        "score_medio_retrieval": score_medio,
        "reintentos": estado.get("intentos", 0),
        "duracion_seg": duracion,
        **evaluar(item, respuesta, documentos, dense_embedder, umbral),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compara el pipeline con grafo frente al baseline sin grafo")
    parser.add_argument("--pausa", type=float, default=DEFAULT_PAUSE, help="segundos entre llamadas al LLM")
    parser.add_argument("--preguntas", type=Path, default=QUESTIONS_PATH)
    parser.add_argument("--umbral-similitud", type=float, default=DEFAULT_SIMILARITY_THRESHOLD)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    questions = json.loads(args.preguntas.read_text(encoding="utf-8"))
    settings = get_settings()

    print("Cargando modelos (embedders, cross-encoder)...")
    dense_embedder = TextEmbedding(model_name="intfloat/multilingual-e5-large")
    sparse_embedder = SparseTextEmbedding(model_name="Qdrant/bm25", language="spanish")
    cross_encoder = TextCrossEncoder(model_name="jinaai/jina-reranker-v2-base-multilingual")
    qdrant = QdrantClient(url=settings.qdrant_url)
    grafo = crear_grafo(dense_embedder, sparse_embedder, qdrant, cross_encoder, settings.llm_model)

    print(f"Evaluando {len(questions)} preguntas x 2 pipelines (baseline, grafo) = {len(questions) * 2} consultas\n")

    filas = []
    for i, item in enumerate(questions, start=1):
        print(f"[{i}/{len(questions)}] ({item['tipo']}) {item['pregunta']}")

        try:
            res_baseline = run_baseline(item, dense_embedder, sparse_embedder, cross_encoder, qdrant, settings.llm_model, args.pausa, args.umbral_similitud)
        except Exception as exc:
            res_baseline = {"pipeline": "baseline", "error": str(exc), "respuesta_correcta": False, "doc_recuperado_ok": False}
            print(f"    baseline: fallo -> {exc}")
        else:
            print(f"    baseline: correcta={res_baseline['respuesta_correcta']} doc_ok={res_baseline['doc_recuperado_ok']} score={res_baseline['score_medio_retrieval']}")

        try:
            res_grafo = run_grafo(item, grafo, dense_embedder, settings.llm_model, args.pausa, args.umbral_similitud)
        except Exception as exc:
            res_grafo = {"pipeline": "grafo", "error": str(exc), "respuesta_correcta": False, "doc_recuperado_ok": False}
            print(f"    grafo:    fallo -> {exc}")
        else:
            print(f"    grafo:    correcta={res_grafo['respuesta_correcta']} doc_ok={res_grafo['doc_recuperado_ok']} score={res_grafo['score_medio_retrieval']} reintentos={res_grafo.get('reintentos')}")

        for res in (res_baseline, res_grafo):
            filas.append({
                "id": item["id"],
                "pregunta": item["pregunta"],
                "tipo": item["tipo"],
                "documento_esperado": item["documento_esperado"],
                **res,
            })

    df = pd.DataFrame(filas)
    df["doc_recuperado_ok_num"] = df["doc_recuperado_ok"].map({True: 1, False: 0})

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = RESULTS_DIR / f"grafo_vs_baseline_{timestamp}.csv"
    df.to_csv(out_path, index=False)

    print("\n" + "=" * 70)
    print("RESUMEN")
    print("=" * 70)

    resumen = df.groupby("pipeline").agg(
        precision=("respuesta_correcta", "mean"),
        retrieval_ok=("doc_recuperado_ok_num", "mean"),
        errores=("error", lambda s: s.notna().sum()) if "error" in df.columns else ("respuesta_correcta", lambda s: 0),
        duracion_media_seg=("duracion_seg", "mean"),
    )
    print(resumen.to_string(float_format=lambda v: f"{v:.2f}"))

    print("\nPrecision por tipo de pregunta y pipeline:")
    tabla_tipo = df.pivot_table(index="tipo", columns="pipeline", values="respuesta_correcta", aggfunc="mean")
    print(tabla_tipo.to_string(float_format=lambda v: f"{v:.0%}"))

    if "reintentos" in df.columns:
        reintentos_grafo = df[df["pipeline"] == "grafo"]["reintentos"].fillna(0)
        print(f"\nReescrituras de consulta activadas por el grafo: {(reintentos_grafo > 0).sum()} / {len(reintentos_grafo)} preguntas")

    print(f"\nResultados guardados en: {out_path}")


if __name__ == "__main__":
    main()
