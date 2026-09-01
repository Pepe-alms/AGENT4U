"""Compara el pipeline con grafo frente al baseline sin grafo en preguntas de
seguimiento que solo tienen sentido con el historial de la conversacion de
por medio (pronombres, referencias a "el segundo caso", etc.), usando
tests/conversaciones_dificiles.json.

A diferencia de tests/grafo_test.py (preguntas sueltas, sin historial), aqui
cada conversacion se ejecuta turno a turno y cada pipeline (baseline, grafo)
mantiene su propio historial acumulado -- no se comparte entre pipelines,
para simular dos conversaciones independientes. Solo se evalua el ultimo
turno de cada conversacion (el que depende del historial); los turnos
anteriores solo sirven para construir contexto.

No es un test de pytest: hace llamadas reales al LLM y a Qdrant.

Uso:
    uv run python tests/grafo_conversacional_test.py
"""

import argparse
import json
import sys
import time
import unicodedata
from dataclasses import dataclass
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

PAUSE = 4.0
RETRIES = 4
SIMILARITY_THRESHOLD = 0.85
TESTS_DIR = Path(__file__).parent
CONVERSATIONS_PATH = TESTS_DIR / "conversaciones_dificiles.json"
RESULTS_DIR = TESTS_DIR / "results"


@dataclass
class Mensaje:
    """Sustituto ligero del modelo de BD: reformular_consulta/generate_query
    solo leen .rol y .contenido, asi que no hace falta tocar la base de datos
    para simular historial de conversacion."""
    rol: str
    contenido: str


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
                time.sleep(5 * (2 ** attempt))
    raise last_error


def evaluar(turno: dict, respuesta: str, documentos_recuperados: list[str], dense_embedder) -> dict:
    vectores = np.array(list(dense_embedder.embed([f"query: {respuesta}", f"query: {turno['respuesta_esperada']}"])))
    similitud = round(cosine_similarity(vectores[0], vectores[1]), 3)
    return {
        "respuesta_correcta": similitud >= SIMILARITY_THRESHOLD,
        "similitud": similitud,
        "contiene_keyword": normalize(turno["debe_contener"]) in normalize(respuesta),
        "doc_recuperado_ok": turno["documento_esperado"] in documentos_recuperados,
    }


def turno_baseline(pregunta: str, historial: list[Mensaje], dense_embedder, sparse_embedder, cross_encoder, qdrant, model: str) -> dict:
    consulta = reformular_consulta(pregunta, historial, model)
    chunks = search_chunks(consulta, dense_embedder, sparse_embedder, qdrant, cross_encoder)
    messages = generate_query(pregunta, chunks, historial)
    respuesta = llm_complete(messages, model)
    return {"respuesta": respuesta, "chunks": chunks, "consulta_reformulada": consulta}


def turno_grafo(pregunta: str, historial: list[Mensaje], grafo, model: str) -> dict:
    estado = grafo.invoke({"query": pregunta, "historial": historial})
    respuesta = llm_complete(estado["messages"], model)
    return {"respuesta": respuesta, "chunks": estado.get("chunks", []), "reintentos": estado.get("intentos", 0)}


def ejecutar_conversacion(conv: dict, dense_embedder, sparse_embedder, cross_encoder, qdrant, grafo, model: str) -> list[dict]:
    historial_baseline: list[Mensaje] = []
    historial_grafo: list[Mensaje] = []
    filas = []

    for i, turno in enumerate(conv["turnos"]):
        es_ultimo = i == len(conv["turnos"]) - 1
        pregunta = turno["pregunta"]
        print(f"  turno {i + 1}: {pregunta}")

        res_b = turno_baseline(pregunta, historial_baseline, dense_embedder, sparse_embedder, cross_encoder, qdrant, model)
        time.sleep(PAUSE)
        res_g = turno_grafo(pregunta, historial_grafo, grafo, model)
        time.sleep(PAUSE)

        historial_baseline.append(Mensaje(rol="user", contenido=pregunta))
        historial_baseline.append(Mensaje(rol="assistant", contenido=res_b["respuesta"]))
        historial_grafo.append(Mensaje(rol="user", contenido=pregunta))
        historial_grafo.append(Mensaje(rol="assistant", contenido=res_g["respuesta"]))

        if not es_ultimo:
            print(f"    baseline -> {res_b['respuesta'][:100]}")
            print(f"    grafo    -> {res_g['respuesta'][:100]}")
            continue

        doc_b = [c["nombre"] for c in res_b["chunks"]]
        doc_g = [c["nombre"] for c in res_g["chunks"]]
        eval_b = evaluar(turno, res_b["respuesta"], doc_b, dense_embedder)
        eval_g = evaluar(turno, res_g["respuesta"], doc_g, dense_embedder)

        print(f"    baseline: correcta={eval_b['respuesta_correcta']} doc_ok={eval_b['doc_recuperado_ok']} consulta_reformulada={res_b['consulta_reformulada']!r}")
        print(f"    grafo:    correcta={eval_g['respuesta_correcta']} doc_ok={eval_g['doc_recuperado_ok']} reintentos={res_g.get('reintentos')}")

        filas.append({"conv_id": conv["id"], "pipeline": "baseline", "pregunta": pregunta, "respuesta": res_b["respuesta"], "documentos_recuperados": doc_b, **eval_b})
        filas.append({"conv_id": conv["id"], "pipeline": "grafo", "pregunta": pregunta, "respuesta": res_g["respuesta"], "documentos_recuperados": doc_g, **eval_g})

    return filas


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compara el grafo frente al baseline en preguntas de seguimiento multi-turno")
    parser.add_argument("--conversaciones", type=Path, default=CONVERSATIONS_PATH)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = get_settings()
    conversaciones = json.loads(args.conversaciones.read_text(encoding="utf-8"))

    print("Cargando modelos...")
    dense_embedder = TextEmbedding(model_name="intfloat/multilingual-e5-large")
    sparse_embedder = SparseTextEmbedding(model_name="Qdrant/bm25", language="spanish")
    cross_encoder = TextCrossEncoder(model_name="jinaai/jina-reranker-v2-base-multilingual")
    qdrant = QdrantClient(url=settings.qdrant_url)
    grafo = crear_grafo(dense_embedder, sparse_embedder, qdrant, cross_encoder, settings.llm_model)

    filas = []
    for conv in conversaciones:
        print(f"\n=== {conv['id']} ===")
        filas.extend(ejecutar_conversacion(conv, dense_embedder, sparse_embedder, cross_encoder, qdrant, grafo, settings.llm_model))

    df = pd.DataFrame(filas)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = RESULTS_DIR / f"conversacional_{timestamp}.csv"
    df.to_csv(out_path, index=False)

    print("\n" + "=" * 70)
    print("RESUMEN (solo turnos de seguimiento, dependientes del historial)")
    print("=" * 70)
    resumen = df.groupby("pipeline").agg(
        precision=("respuesta_correcta", "mean"),
        retrieval_ok=("doc_recuperado_ok", "mean"),
    )
    print(resumen.to_string(float_format=lambda v: f"{v:.2f}"))
    print(f"\nResultados guardados en: {out_path}")


if __name__ == "__main__":
    main()
