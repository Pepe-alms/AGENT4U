"""Script de evaluacion del pipeline RAG contra tests/response_file.json.

Uso:
    uv run python tests/response_test.py
    uv run python tests/response_test.py --rondas 3 --umbral-similitud 0.85

No es un test de pytest: hace llamadas reales al LLM (version gratuita, con
limite de peticiones por minuto) y a Qdrant, asi que se ejecuta como script,
no como parte de la suite automatica.

El acierto de cada ronda se mide por similitud coseno entre el embedding de
la respuesta generada y el de "respuesta_esperada" (mismo embedder que ya
usamos para retrieval, sin llamadas adicionales al LLM), no por coincidencia
literal de texto: un LLM puede parafrasear una respuesta correcta.

Genera dos reportes independientes por corrida:
  - reporte_ejecucion.html / ejecucion_por_pregunta.csv
      El automatismo de la solicitud: que documentos recupero cada consulta,
      cuanto tardo, si hubo errores. Nada sobre si la respuesta es correcta.
  - reporte_eficacia.html / eficacia_por_pregunta.csv
      Si la respuesta generada es correcta: similitud semantica, precision,
      consistencia entre rondas.
"""

import argparse
import json
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd
from fastembed import TextEmbedding
from qdrant_client import QdrantClient

from app.core.config import get_settings
from app.rag.generation import generate_response
from app.retrieval.retrieval import search_chunks

DEFAULT_ROUNDS = 5
DEFAULT_PAUSE = 5.0  # version gratuita de Gemini: 15 peticiones/min
DEFAULT_SIMILARITY_THRESHOLD = 0.85
RETRIES = 4
TESTS_DIR = Path(__file__).parent
QUESTIONS_PATH = TESTS_DIR / "response_file.json"
RESULTS_DIR = TESTS_DIR / "results"
ABSENT_PHRASE = "no encuentro esa informacion"


def normalize(text: str | None) -> str:
    if not text:
        return ""
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def evaluate_response(item: dict, response: str, retrieved_documents: list[str], embedder, threshold: float) -> dict:
    if item["tipo"] == "ausente":
        return {"acierto": ABSENT_PHRASE in normalize(response), "similitud": None, "doc_recuperado_ok": None}

    vectors = np.array(list(embedder.embed([f"query: {response}", f"query: {item['respuesta_esperada']}"])))
    similarity = round(cosine_similarity(vectors[0], vectors[1]), 3)
    return {
        "acierto": similarity >= threshold,
        "similitud": similarity,
        "doc_recuperado_ok": item["documento_esperado"] in retrieved_documents,
    }


def run_round(item: dict, embedder, qdrant, model: str, round_num: int, threshold: float) -> dict:
    t0 = time.perf_counter()
    response, retrieved_documents, retrieved_pages, error = "", [], [], None
    average_retrieval_score = None

    for attempt in range(RETRIES):
        try:
            chunks = search_chunks(query=item["pregunta"], embedder=embedder, qdrant=qdrant)
            retrieved_documents = [c["nombre"] for c in chunks]
            retrieved_pages = sorted({p for c in chunks for p in c.get("paginas", [])})
            average_retrieval_score = round(sum(c["score"] for c in chunks) / len(chunks), 3) if chunks else None
            response = generate_response(query=item["pregunta"], chunks=chunks, model=model)
            error = None
            break
        except Exception as exc:
            error = str(exc)
            if attempt < RETRIES - 1:
                time.sleep(5 * (2 ** attempt))  # 5s, 10s, 20s

    duration = round(time.perf_counter() - t0, 2)
    evaluation = (
        {"acierto": False, "similitud": None, "doc_recuperado_ok": None}
        if error
        else evaluate_response(item, response, retrieved_documents, embedder, threshold)
    )

    return {
        "id": item["id"],
        "ronda": round_num,
        "pregunta": item["pregunta"],
        "tipo": item["tipo"],
        "documento_esperado": item["documento_esperado"],
        "respuesta_esperada": item["respuesta_esperada"],
        "respuesta": response,
        "documentos_recuperados": retrieved_documents,
        "paginas_recuperadas": retrieved_pages,
        "score_medio_retrieval": average_retrieval_score,
        "duracion_seg": duration,
        "error": error,
        **evaluation,
    }


def run_evaluation(questions: list[dict], rounds: int, pause_seconds: float, threshold: float) -> list[dict]:
    settings = get_settings()
    embedder = TextEmbedding(model_name="intfloat/multilingual-e5-large")
    qdrant = QdrantClient(url=settings.qdrant_url)

    results = []
    total = len(questions) * rounds
    counter = 0
    for item in questions:
        for round_num in range(1, rounds + 1):
            counter += 1
            print(f"[{counter}/{total}] pregunta {item['id']} ({item['tipo']}) - ronda {round_num}")
            result = run_round(item, embedder, qdrant, settings.llm_model, round_num, threshold)
            if result["error"]:
                print(f"    fallo definitivo: {result['error'][:120]}")
            results.append(result)
            time.sleep(pause_seconds)
    return results


# --------------------------------------------------------------------------
# Reporte (pandas Styler -> HTML, sin plantillas manuales)
# --------------------------------------------------------------------------

def value_color(value: float) -> str:
    if pd.isna(value):
        return ""
    color = "#0ca30c" if value >= 0.8 else "#fab219" if value >= 0.5 else "#d03b3b"
    return f"background-color: {color}22; color: {color}; font-weight: 600"


PAGE_STYLE = """
body { font-family: system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 32px auto; padding: 0 16px; color: #222; }
h1 { font-size: 20px; margin-bottom: 4px; }
h2 { font-size: 15px; margin-top: 32px; }
.subtitulo { color: #666; font-size: 13px; margin-bottom: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin-top: 8px; }
th, td { padding: 6px 10px; border-bottom: 1px solid #e1e0d9; text-align: left; vertical-align: top; }
th { color: #666; font-weight: 600; }
"""


def html_page(title: str, subtitle: str, blocks: list[tuple[str, str]]) -> str:
    body = "".join(f"<h2>{section_title}</h2>{section_html}" for section_title, section_html in blocks)
    return f'''<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>{title}</title>
<style>{PAGE_STYLE}</style></head>
<body>
<h1>{title}</h1>
<div class="subtitulo">{subtitle}</div>
{body}
</body></html>'''


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evalua el pipeline RAG contra tests/response_file.json")
    parser.add_argument("--rondas", type=int, default=DEFAULT_ROUNDS)
    parser.add_argument("--pausa", type=float, default=DEFAULT_PAUSE, help="segundos entre consultas al LLM")
    parser.add_argument("--umbral-similitud", type=float, default=DEFAULT_SIMILARITY_THRESHOLD)
    parser.add_argument("--preguntas", type=Path, default=QUESTIONS_PATH)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    questions = json.loads(args.preguntas.read_text(encoding="utf-8"))

    print(f"Evaluando {len(questions)} preguntas x {args.rondas} rondas = {len(questions) * args.rondas} consultas")
    results = run_evaluation(questions, args.rondas, args.pausa, args.umbral_similitud)

    df = pd.DataFrame(results)
    df["doc_recuperado_ok_num"] = df["doc_recuperado_ok"].map({True: 1, False: 0})
    df["documentos_recuperados_txt"] = df["documentos_recuperados"].apply(", ".join)
    df["paginas_recuperadas_txt"] = df["paginas_recuperadas"].apply(lambda ps: ", ".join(str(p) for p in ps))
    df["error_corto"] = df["error"].fillna("").str.slice(0, 120)

    global_precision = df["acierto"].mean()
    global_retrieval = df["doc_recuperado_ok_num"].mean()
    total_errors = int(df["error"].notna().sum())

    accuracy_by_type = df.groupby("tipo")["acierto"].mean().sort_values(ascending=False).to_frame("precision")
    accuracy_by_question = (
        df.groupby(["id", "pregunta", "tipo"], sort=False)
        .agg(
            aciertos=("acierto", "sum"),
            rondas=("acierto", "count"),
            similitud_media=("similitud", "mean"),
            consistente=("acierto", lambda s: s.nunique() == 1),
        )
        .reset_index()
    )
    accuracy_by_question["precision"] = accuracy_by_question["aciertos"] / accuracy_by_question["rondas"]
    accuracy_by_question = accuracy_by_question.sort_values("precision")

    execution_by_type = df.groupby("tipo")["doc_recuperado_ok_num"].mean().sort_values(ascending=False).to_frame("retrieval_ok_rate")
    execution_by_question = (
        df.groupby(["id", "pregunta", "tipo", "documento_esperado"], sort=False)
        .agg(
            retrieval_ok_rate=("doc_recuperado_ok_num", "mean"),
            score_medio_retrieval=("score_medio_retrieval", "mean"),
            duracion_media_seg=("duracion_seg", "mean"),
            duracion_max_seg=("duracion_seg", "max"),
            errores=("error", lambda s: s.notna().sum()),
        )
        .reset_index()
        .sort_values("retrieval_ok_rate")
    )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = RESULTS_DIR / f"run_{timestamp}"
    run_dir.mkdir(parents=True, exist_ok=True)

    subtitle = (
        f"{timestamp} &middot; modelo {get_settings().llm_model} &middot; "
        f"{len(questions)} preguntas &times; {args.rondas} rondas &middot; "
        f"umbral similitud {args.umbral_similitud} &middot; "
        f"precision global {global_precision:.0%} &middot; retrieval global {global_retrieval:.0%} &middot; "
        f"errores definitivos {total_errors}"
    )

    (run_dir / "reporte_eficacia.html").write_text(
        html_page(
            "Reporte de eficacia",
            subtitle,
            [
                ("Precision por tipo", accuracy_by_type.style.format("{:.0%}").map(value_color).to_html()),
                (
                    "Resumen por pregunta (peor precision primero)",
                    accuracy_by_question.style
                    .format({"precision": "{:.0%}", "similitud_media": "{:.2f}"})
                    .map(value_color, subset=["precision"])
                    .hide(axis="index").to_html(),
                ),
                (
                    "Detalle de todas las rondas (revision manual)",
                    df[["id", "pregunta", "ronda", "tipo", "respuesta_esperada", "respuesta", "similitud", "acierto"]]
                    .style.format({"similitud": "{:.2f}"})
                    .hide(axis="index").to_html(),
                ),
            ],
        ),
        encoding="utf-8",
    )

    (run_dir / "reporte_ejecucion.html").write_text(
        html_page(
            "Reporte de ejecucion",
            subtitle,
            [
                ("Retrieval-hit por tipo", execution_by_type.style.format("{:.0%}").map(value_color).to_html()),
                (
                    "Resumen por pregunta (peor retrieval primero)",
                    execution_by_question.style
                    .format({
                        "retrieval_ok_rate": "{:.0%}",
                        "score_medio_retrieval": "{:.3f}",
                        "duracion_media_seg": "{:.2f}s",
                        "duracion_max_seg": "{:.2f}s",
                    })
                    .map(value_color, subset=["retrieval_ok_rate"])
                    .hide(axis="index").to_html(),
                ),
                (
                    "Log de todas las rondas",
                    df[["id", "pregunta", "ronda", "documentos_recuperados_txt", "paginas_recuperadas_txt", "score_medio_retrieval", "duracion_seg", "error_corto"]]
                    .style.format({"score_medio_retrieval": "{:.3f}"})
                    .hide(axis="index").to_html(),
                ),
            ],
        ),
        encoding="utf-8",
    )

    accuracy_by_question.to_csv(run_dir / "eficacia_por_pregunta.csv", index=False)
    execution_by_question.to_csv(run_dir / "ejecucion_por_pregunta.csv", index=False)
    (run_dir / "rondas_detalle.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nPrecision global: {global_precision:.0%}")
    print(f"Retrieval global: {global_retrieval:.0%}")
    print(f"Errores definitivos: {total_errors}")
    print(f"\nResultados guardados en: {run_dir}")
    print(f"Reporte de eficacia: {run_dir / 'reporte_eficacia.html'}")
    print(f"Reporte de ejecucion: {run_dir / 'reporte_ejecucion.html'}")


if __name__ == "__main__":
    main()
