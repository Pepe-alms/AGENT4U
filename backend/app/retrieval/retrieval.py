# from fastembed import TextEmbedding
# import numpy as np

# from app.core.config import get_settings

# import litellm

# from qdrant_client import QdrantClient

# system_prompt = """Eres un asistente que responde preguntas basándote ÚNICAMENTE en el contexto proporcionado.

# Reglas estrictas:
# - Responde solo con información presente en el contexto. No uses conocimiento previo.
# - Si el contexto no contiene la respuesta, di exactamente: "No encuentro esa información en el documento." No inventes ni completes con lo que sepas.
# - Cita el número de fragmento del que sacas cada afirmación, con el formato [1], [2], etc."""


# query_string:str = "query: ¿Cual es la capital de francia?"

# client = QdrantClient(url=get_settings().qdrant_url)

# query_vector = np.array(list(TextEmbedding(model_name="intfloat/multilingual-e5-large").embed([query_string])))

# search_result = client.query_points(
#     collection_name="Test_1",
#     query=query_vector[0], ## Saco el unico vector de la lista de vectores
#     limit=5,
#     with_payload=True,
# ).points

# # print(f"Resultados de la búsqueda para la consulta: '{query_string}'")
# # for i, result in enumerate(search_result):
# #     print(f"Resultado {i+1}:")
# #     print(f"  ID: {result.id}")
# #     print(f"  Distancia: {result.score}")
# #     print(f"  Chunk: {result.payload['chunk']}")

# vectores_optimos = []
# for i, result in enumerate(search_result):
#     texto = result.payload['chunk']
#     vectores_optimos.append(f"[{i+1}]: {texto}")

# contexto = "\n\n".join(vectores_optimos)

# consulta = f"Contexto:{contexto} Consulta:{query_string}"


# respuesta = litellm.completion( 
#     model = "gemini/gemini-flash-lite-latest",
#     messages = [{"role": "user", "content": consulta},
#                 {"role": "system", "content": system_prompt}])

# print(respuesta.choices[0].message.content)

import numpy as np
from qdrant_client import models

def buscar_chunks (query: str, dense_embedder, sparse_embedder, qdrant, limite: int = 5) -> list[str]:
    query_vector_dense = list(dense_embedder.embed([f"query: {query}"]))
    query_vector_sparse = list(sparse_embedder.embed([f"query: {query}"]))

    query_result = qdrant.query_points(
        collection_name="Test_1",
        prefetch= [
            models.Prefetch(
                query=models.SparseVector(
                    indices=query_vector_sparse.indices.tolist(),
                    values=query_vector_sparse.values.tolist()
                ),
                using="sparse_vector",
                limit = 5,
            ),
            models.Prefetch(
                query=query_vector_dense.tolist(),
                using="dense_vector",
                limit = 5,
            ),        
        ],
        query=models.RrfQuery(rrf=models.Rrf()),
        with_payload=True,
    ).points

    return [
        {
            "chunk": result.payload["texto"],
            "nombre": result.payload["nombre"],
            "headings": result.payload.get("headings", []),
            "paginas": result.payload.get("paginas", []),
            "score": result.score,
        }
        for result in query_result
    ]