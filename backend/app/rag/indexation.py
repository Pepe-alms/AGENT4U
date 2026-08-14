import numpy as np

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

def embed_texts(chunks: list, embedder: str, qdrant: AsyncQdrantClient, nombre: str):
    embeder_generator = embedder.embed(chunks)
    vectores = np.array(list(embeder_generator))

    for i, (chunk, vector) in enumerate(zip(chunks, vectores)):
        punto =PointStruct(
            id=i,
            vector=vector.tolist(),
            payload={"chunk": chunk}
        )
        if i == 0:
            puntos = [punto]
        else:
            puntos.append(punto)

    qdrant.upsert(
        collection_name="Test_1",
        points=puntos
    )