from qdrant_client import models

from app.rag.vectorization import COLLECTION_NAME


def cross_encode(query: str, documents: list[str], cross_encoder, files: list[str], pages: list[list[str]], urls: list[str]) -> list[float]:
    scores = list(cross_encoder.rerank(query=query, documents=documents))
    print(f"Scores: {scores}")
    ranked = sorted(zip(documents, scores, files, pages, urls), key=lambda x: x[1], reverse=True)
    ranked_results = []

    for doc, score, file, page, url in ranked[:10]:
        ranked_results.append(
            {
            "chunk": doc,
            "nombre": file,
            "paginas": page,
            "url": url,
            "score": float(score),
            }
        )

    return ranked_results


def search_chunks (query: str, dense_embedder, sparse_embedder, qdrant, cross_encoder) -> list[str]:
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
                                 cross_encoder=cross_encoder)
    
    return ranked_results