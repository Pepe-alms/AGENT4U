import numpy as np
from qdrant_client.models import PointStruct, VectorParams, Distance
import uuid

def id_desde_texto(texto: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, texto))

def normalize_text(ruta_archivo: str, converter, chunker):
    convertir_texto = converter.convert(ruta_archivo)
    chunks = chunker.chunk(dl_doc=convertir_texto.document)

    textos_para_embeber = []
    chunks_limpios = []

    for chunk in chunks:
        texto = chunker.contextualize(chunk)
        if len(texto) >= 100:
            chunks_limpios.append(texto)
            textos_para_embeber.append(f"passage: {texto}")

    return textos_para_embeber

def embed_texts(chunks: list, embedder: str, qdrant, nombre: str):
    embeder_generator = embedder.embed(chunks)
    vectores = np.array(list(embeder_generator))

    if qdrant.collection_exists(collection_name="Test_1") == False:
        qdrant.create_collection(
        collection_name="Test_1", 
        vectors_config=VectorParams(size= 1024, distance=Distance.COSINE))



    for i, (chunk, vector) in enumerate(zip(chunks, vectores)):
        punto =PointStruct(
            id=id_desde_texto(chunk),
            vector=vector.tolist(),
            payload={"chunk": chunk, "nombre": nombre}
        )
        if i == 0:
            puntos = [punto]
        else:
            puntos.append(punto)

    qdrant.upsert(
        collection_name="Test_1",
        points=puntos
    )