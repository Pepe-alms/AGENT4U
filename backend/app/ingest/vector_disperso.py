
from fastembed import SparseTextEmbedding

frase = "la lista de la compra 1 es: huevos, leche, pan"

embeder = SparseTextEmbedding(model_name="Qdrant/bm25", language="spanish")
vectores = embeder.embed([frase])

print(list(vectores))