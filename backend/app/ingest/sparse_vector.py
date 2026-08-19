
from fastembed import SparseTextEmbedding

phrase = "la lista de la compra 1 es: huevos, leche, pan"

embedder = SparseTextEmbedding(model_name="Qdrant/bm25", language="spanish")
vectors = embedder.embed([phrase])

print(list(vectors))