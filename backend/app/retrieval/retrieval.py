from fastembed import TextEmbedding
import numpy as np

from app.core.config import get_settings

from qdrant_client import QdrantClient

query_string:str = "query: ¿Qué es el big data?"

client = QdrantClient(url=get_settings().qdrant_url)

query_vector = np.array(list(TextEmbedding(model_name="intfloat/multilingual-e5-large").embed([query_string])))

search_result = client.query_points(
    collection_name="Test_1",
    query=query_vector[0],
    limit=5,
    with_payload=True,
).points

print(f"Resultados de la búsqueda para la consulta: '{query_string}'")
for i, result in enumerate(search_result):
    print(f"Resultado {i+1}:")
    print(f"  ID: {result.id}")
    print(f"  Distancia: {result.score}")
    print(f"  Chunk: {result.payload['chunk']}")
    