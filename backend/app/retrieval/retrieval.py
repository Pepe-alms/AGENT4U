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

def buscar_chunks (query: str, embedder, qdrant, limite: int = 5) -> list[str]:
    query_vector = np.array(list(
    embedder.embed([f"query: {query}"])))[0]

    query_result = qdrant.query_points(
        collection_name="Test_1",
        query=query_vector,
        limit=limite,
        with_payload=True,
    ).points

    return [result.payload['chunk'] for result in query_result]