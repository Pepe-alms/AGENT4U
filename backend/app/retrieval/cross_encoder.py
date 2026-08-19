from fastembed.rerank.cross_encoder import TextCrossEncoder

encoder = TextCrossEncoder(model_name = "jinaai/jina-reranker-v2-base-multilingual")

scores = list(encoder.rerank(
    query="¿Cuál es la capital de Francia?",
    documents=[
        "La capital de Francia es París.",
        "La capital de España es Madrid.",
        "La capital de Italia es Roma."
    ],
))

documents=[
        "La capital de Francia es París.",
        "La capital de España es Madrid.",
        "La capital de Italia es Roma."
    ]


for doc, score in zip(documents, scores):
    print(f"Documento: {doc}, Score: {score}")

