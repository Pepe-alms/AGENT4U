from qdrant_client import models

from app.rag.vectorization import COLLECTION_NAME


def cross_encode(query: str, documents: list[str], cross_encoder, files: list[str], pages: list[list[str]], urls: list[str], headings: list[list[str]] | None = None, max_fragmentos: int = 10, origenes: list[str] | None = None, documento_ids: list[int | None] | None = None) -> list[dict]:
    scores = list(cross_encoder.rerank(query=query, documents=documents))
    # Si el llamante no pasa titulos de seccion, se rellena con listas vacias
    # para que el zip no acorte el resto de columnas.
    headings = headings if headings is not None else [[] for _ in documents]
    origenes = origenes if origenes is not None else ["" for _ in documents]
    documento_ids = documento_ids if documento_ids is not None else [None for _ in documents]
    ranked = sorted(
        zip(documents, scores, files, pages, urls, headings, origenes, documento_ids),
        key=lambda x: x[1],
        reverse=True,
    )
    ranked_results = []

    # Cuantos fragmentos llegan al modelo. Lo decide quien llama, que a su
    # vez lo recibe de POST /preguntar.
    for doc, score, file, page, url, heading, origen, documento_id in ranked[:max_fragmentos]:
        ranked_results.append(
            {
            "chunk": doc,
            "nombre": file,
            "origen": origen,
            "documento_id": documento_id,
            "paginas": page,
            "url": url,
            "headings": heading,
            "score": float(score),
            }
        )

    return ranked_results


def search_chunks (query: str, dense_embedder, sparse_embedder, qdrant, cross_encoder, max_fragmentos: int = 10) -> list[str]:
    query_vector_dense = next(iter(dense_embedder.embed([f"query: {query}"])))
    query_vector_sparse = next(iter(sparse_embedder.embed([query])))

    query_result = qdrant.query_points(
        collection_name=COLLECTION_NAME,
        prefetch= [
            models.Prefetch(
                query=models.SparseVector(
                    indices=query_vector_sparse.indices.tolist(),
                    values=query_vector_sparse.values.tolist()
                ),
                using="sparse_vector",
                limit = 20,
            ),
            models.Prefetch(
                query=query_vector_dense.tolist(),
                using="dense_vector",
                limit = 20,
            ),        
        ],
        query=models.RrfQuery(rrf=models.Rrf()),
        limit=20,
        with_payload=True,
    ).points

    # Cross-encoder
    ranked_results = cross_encode(query=query,
                                 documents=[result.payload["texto"] for result in query_result],
                                 files=[result.payload["nombre"] for result in query_result],
                                 pages=[result.payload.get("paginas", []) for result in query_result],
                                 urls=[result.payload.get("url") for result in query_result],
                                 # Se indexa en vectorization.py pero hasta ahora
                                 # no se recuperaba, asi que la seccion que
                                 # enseña el frontend salia siempre vacia.
                                 headings=[result.payload.get("headings", []) for result in query_result],
                                 # Los puntos indexados antes de documento_id
                                 # no lo tienen: llegan como None.
                                 origenes=[result.payload.get("origen", "") for result in query_result],
                                 documento_ids=[result.payload.get("documento_id") for result in query_result],
                                 cross_encoder=cross_encoder,
                                 max_fragmentos=max_fragmentos)
    
    return ranked_results