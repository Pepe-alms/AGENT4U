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
from app.retrieval.retrieval import buscar_chunks

RONDAS_POR_DEFECTO = 5
PAUSA_POR_DEFECTO = 5.0  # version gratuita de Gemini: 15 peticiones/min
UMBRAL_SIMILITUD_DEFECTO = 0.85
REINTENTOS = 4
DIRECTORIO_TESTS = Path(__file__).parent
PREGUNTAS_PATH = DIRECTORIO_TESTS / "response_file.json"
RESULTS_DIR = DIRECTORIO_TESTS / "results"
FRASE_AUSENTE = "no encuentro esa informacion"


def normalizar(texto: str | None) -> str:
    if not texto:
        return ""
    return unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii").lower()


def similitud_coseno(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def evaluar_respuesta(item: dict, respuesta: str, documentos_recuperados: list[str], embedder, umbral: float) -> dict:
    if item["tipo"] == "ausente":
        return {"acierto": FRASE_AUSENTE in normalizar(respuesta), "similitud": None, "doc_recuperado_ok": None}

    vectores = np.array(list(embedder.embed([f"query: {respuesta}", f"query: {item['respuesta_esperada']}"])))
    similitud = round(similitud_coseno(vectores[0], vectores[1]), 3)
    return {
        "acierto": similitud >= umbral,
        "similitud": similitud,
        "doc_recuperado_ok": item["documento_esperado"] in documentos_recuperados,
    }


def ejecutar_ronda(item: dict, embedder, qdrant, model: str, ronda: int, umbral: float) -> dict:
    t0 = time.perf_counter()
    respuesta, documentos_recuperados, paginas_recuperadas, error = "", [], [], None
    score_medio_retrieval = None

    for intento in range(REINTENTOS):
        try:
            chunks = buscar_chunks(query=item["pregunta"], embedder=embedder, qdrant=qdrant)
            documentos_recuperados = [c["nombre"] for c in chunks]
            paginas_recuperadas = sorted({p for c in chunks for p in c.get("paginas", [])})
            score_medio_retrieval = round(sum(c["score"] for c in chunks) / len(chunks), 3) if chunks else None
            respuesta = generate_response(query=item["pregunta"], chunks=chunks, model=model)
            error = None
            break
        except Exception as exc:
            error = str(exc)
            if intento < REINTENTOS - 1:
                time.sleep(5 * (2 ** intento))  # 5s, 10s, 20s

    duracion = round(time.perf_counter() - t0, 2)
    evaluacion = (
        {"acierto": False, "similitud": None, "doc_recuperado_ok": None}
        if error
        else evaluar_respuesta(item, respuesta, documentos_recuperados, embedder, umbral)
    )

    return {
        "id": item["id"],
        "ronda": ronda,
        "pregunta": item["pregunta"],
        "tipo": item["tipo"],
        "documento_esperado": item["documento_esperado"],
        "respuesta_esperada": item["respuesta_esperada"],
        "respuesta": respuesta,
        "documentos_recuperados": documentos_recuperados,
        "paginas_recuperadas": paginas_recuperadas,
        "score_medio_retrieval": score_medio_retrieval,
        "duracion_seg": duracion,
        "error": error,
        **evaluacion,
    }


def ejecutar_evaluacion(preguntas: list[dict], rondas: int, pausa_seg: float, umbral: float) -> list[dict]:
    settings = get_settings()
    embedder = TextEmbedding(model_name="intfloat/multilingual-e5-large")
    qdrant = QdrantClient(url=settings.qdrant_url)

    resultados = []
    total = len(preguntas) * rondas
    contador = 0
    for item in preguntas:
        for ronda in range(1, rondas + 1):
            contador += 1
            print(f"[{contador}/{total}] pregunta {item['id']} ({item['tipo']}) - ronda {ronda}")
            resultado = ejecutar_ronda(item, embedder, qdrant, settings.llm_model, ronda, umbral)
            if resultado["error"]:
                print(f"    fallo definitivo: {resultado['error'][:120]}")
            resultados.append(resultado)
            time.sleep(pausa_seg)
    return resultados


# --------------------------------------------------------------------------
# Reporte (pandas Styler -> HTML, sin plantillas manuales)
# --------------------------------------------------------------------------

def color_valor(val: float) -> str:
    if pd.isna(val):
        return ""
    color = "#0ca30c" if val >= 0.8 else "#fab219" if val >= 0.5 else "#d03b3b"
    return f"background-color: {color}22; color: {color}; font-weight: 600"


ESTILO_PAGINA = """
body { font-family: system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 32px auto; padding: 0 16px; color: #222; }
h1 { font-size: 20px; margin-bottom: 4px; }
h2 { font-size: 15px; margin-top: 32px; }
.subtitulo { color: #666; font-size: 13px; margin-bottom: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin-top: 8px; }
th, td { padding: 6px 10px; border-bottom: 1px solid #e1e0d9; text-align: left; vertical-align: top; }
th { color: #666; font-weight: 600; }
"""


def pagina_html(titulo: str, subtitulo: str, bloques: list[tuple[str, str]]) -> str:
    cuerpo = "".join(f"<h2>{t}</h2>{h}" for t, h in bloques)
    return f'''<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>{titulo}</title>
<style>{ESTILO_PAGINA}</style></head>
<body>
<h1>{titulo}</h1>
<div class="subtitulo">{subtitulo}</div>
{cuerpo}
</body></html>'''


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evalua el pipeline RAG contra tests/response_file.json")
    parser.add_argument("--rondas", type=int, default=RONDAS_POR_DEFECTO)
    parser.add_argument("--pausa", type=float, default=PAUSA_POR_DEFECTO, help="segundos entre consultas al LLM")
    parser.add_argument("--umbral-similitud", type=float, default=UMBRAL_SIMILITUD_DEFECTO)
    parser.add_argument("--preguntas", type=Path, default=PREGUNTAS_PATH)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    preguntas = json.loads(args.preguntas.read_text(encoding="utf-8"))

    print(f"Evaluando {len(preguntas)} preguntas x {args.rondas} rondas = {len(preguntas) * args.rondas} consultas")
    resultados = ejecutar_evaluacion(preguntas, args.rondas, args.pausa, args.umbral_similitud)

    df = pd.DataFrame(resultados)
    df["doc_recuperado_ok_num"] = df["doc_recuperado_ok"].map({True: 1, False: 0})
    df["documentos_recuperados_txt"] = df["documentos_recuperados"].apply(", ".join)
    df["paginas_recuperadas_txt"] = df["paginas_recuperadas"].apply(lambda ps: ", ".join(str(p) for p in ps))
    df["error_corto"] = df["error"].fillna("").str.slice(0, 120)

    precision_global = df["acierto"].mean()
    retrieval_global = df["doc_recuperado_ok_num"].mean()
    errores_totales = int(df["error"].notna().sum())

    eficacia_tipo = df.groupby("tipo")["acierto"].mean().sort_values(ascending=False).to_frame("precision")
    eficacia_pregunta = (
        df.groupby(["id", "pregunta", "tipo"], sort=False)
        .agg(
            aciertos=("acierto", "sum"),
            rondas=("acierto", "count"),
            similitud_media=("similitud", "mean"),
            consistente=("acierto", lambda s: s.nunique() == 1),
        )
        .reset_index()
    )
    eficacia_pregunta["precision"] = eficacia_pregunta["aciertos"] / eficacia_pregunta["rondas"]
    eficacia_pregunta = eficacia_pregunta.sort_values("precision")

    ejecucion_tipo = df.groupby("tipo")["doc_recuperado_ok_num"].mean().sort_values(ascending=False).to_frame("retrieval_ok_rate")
    ejecucion_pregunta = (
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

    subtitulo = (
        f"{timestamp} &middot; modelo {get_settings().llm_model} &middot; "
        f"{len(preguntas)} preguntas &times; {args.rondas} rondas &middot; "
        f"umbral similitud {args.umbral_similitud} &middot; "
        f"precision global {precision_global:.0%} &middot; retrieval global {retrieval_global:.0%} &middot; "
        f"errores definitivos {errores_totales}"
    )

    (run_dir / "reporte_eficacia.html").write_text(
        pagina_html(
            "Reporte de eficacia",
            subtitulo,
            [
                ("Precision por tipo", eficacia_tipo.style.format("{:.0%}").map(color_valor).to_html()),
                (
                    "Resumen por pregunta (peor precision primero)",
                    eficacia_pregunta.style
                    .format({"precision": "{:.0%}", "similitud_media": "{:.2f}"})
                    .map(color_valor, subset=["precision"])
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
        pagina_html(
            "Reporte de ejecucion",
            subtitulo,
            [
                ("Retrieval-hit por tipo", ejecucion_tipo.style.format("{:.0%}").map(color_valor).to_html()),
                (
                    "Resumen por pregunta (peor retrieval primero)",
                    ejecucion_pregunta.style
                    .format({
                        "retrieval_ok_rate": "{:.0%}",
                        "score_medio_retrieval": "{:.3f}",
                        "duracion_media_seg": "{:.2f}s",
                        "duracion_max_seg": "{:.2f}s",
                    })
                    .map(color_valor, subset=["retrieval_ok_rate"])
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

    eficacia_pregunta.to_csv(run_dir / "eficacia_por_pregunta.csv", index=False)
    ejecucion_pregunta.to_csv(run_dir / "ejecucion_por_pregunta.csv", index=False)
    (run_dir / "rondas_detalle.json").write_text(json.dumps(resultados, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nPrecision global: {precision_global:.0%}")
    print(f"Retrieval global: {retrieval_global:.0%}")
    print(f"Errores definitivos: {errores_totales}")
    print(f"\nResultados guardados en: {run_dir}")
    print(f"Reporte de eficacia: {run_dir / 'reporte_eficacia.html'}")
    print(f"Reporte de ejecucion: {run_dir / 'reporte_ejecucion.html'}")


if __name__ == "__main__":
    main()
