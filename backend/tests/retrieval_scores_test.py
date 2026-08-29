"""Diagnostico de puntuaciones del cross-encoder para tests/response_file.json.

No es un test de pytest: hace llamadas reales a Qdrant y a los modelos de
embedding/rerank, asi que se ejecuta como script.

A diferencia de response_test.py, aqui no se genera respuesta con el LLM ni
se hacen rondas: solo interesa la puntuacion del cross-encoder sobre los
candidatos que le llegan (hasta 20, antes de recortar a los 5 finales que
usa el prompt), para ver si existe un umbral que separe las preguntas con
contexto relevante de las que no.

Uso:
    uv run python tests/retrieval_scores_test.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd
from fastembed import SparseTextEmbedding, TextEmbedding
from fastembed.rerank.cross_encoder import TextCrossEncoder
from qdrant_client import QdrantClient

from app.core.config import get_settings
from app.rag.retrieval import search_chunks

TESTS_DIR = Path(__file__).parent
QUESTIONS_PATH = TESTS_DIR / "response_file.json"
RESULTS_DIR = TESTS_DIR / "results"


def score_question(item: dict, dense_embedder, sparse_embedder, cross_encoder, qdrant) -> dict:
    chunks = search_chunks(
        query=item["pregunta"],
        dense_embedder=dense_embedder,
        sparse_embedder=sparse_embedder,
        qdrant=qdrant,
        cross_encoder=cross_encoder,
    )
    scores = [c["score"] for c in chunks]
    return {
        "id": item["id"],
        "tipo": item["tipo"],
        "maxima": scores[0] if len(scores) > 0 else None,
        "segunda": scores[1] if len(scores) > 1 else None,
        "tercera": scores[2] if len(scores) > 2 else None,
        "n_candidatos": len(scores),
    }


def main() -> None:
    settings = get_settings()
    dense_embedder = TextEmbedding(model_name="intfloat/multilingual-e5-large")
    sparse_embedder = SparseTextEmbedding(model_name="Qdrant/bm25", language="spanish")
    cross_encoder = TextCrossEncoder(model_name="jinaai/jina-reranker-v2-base-multilingual")
    qdrant = QdrantClient(url=settings.qdrant_url)

    questions = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8"))

    rows = []
    for i, item in enumerate(questions, start=1):
        print(f"[{i}/{len(questions)}] pregunta {item['id']} ({item['tipo']})")
        rows.append(score_question(item, dense_embedder, sparse_embedder, cross_encoder, qdrant))

    df = pd.DataFrame(rows).sort_values("maxima", ascending=False)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RESULTS_DIR / "puntuaciones_cross_encoder.csv"
    df.to_csv(out_path, index=False)

    vista = df.copy()
    vista["tipo"] = vista["tipo"].where(vista["tipo"] != "ausente", vista["tipo"] + " *")

    with pd.option_context("display.max_rows", None, "display.width", 140):
        print("\nPuntuaciones del cross-encoder, ordenadas por la maxima:\n")
        print(vista[["id", "tipo", "maxima", "segunda", "tercera"]].to_string(index=False))

    print("\n(* = pregunta de tipo 'ausente', no deberia tener contexto relevante)")
    print(f"Guardado en: {out_path}")


if __name__ == "__main__":
    main()
