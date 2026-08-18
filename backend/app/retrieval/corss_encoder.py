from fastembed.rerank.cross_encoder import TextCrossEncoder

encoder = TextCrossEncoder(model_name = "jinaai/jina-reranker-v2-base-multilingual")

respuesta = encoder.rerank(
    query="¿Cuál es la capital de Francia?",
    documents=[
        "La capital de Francia es París.",
        "La capital de España es Madrid.",
        "La capital de Italia es Roma."
    ],
    top_k=2
)

print("Resultado de la reordenación: ", respuesta)