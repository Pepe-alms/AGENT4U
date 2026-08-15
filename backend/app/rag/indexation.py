import numpy as np
from qdrant_client.models import PointStruct, VectorParams, Distance
import uuid
import datetime

def id_desde_texto(texto: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, texto))

def normalize_text(ruta_archivo: str, converter, chunker):
    convertir_texto = converter.convert(ruta_archivo)
    chunks = chunker.chunk(dl_doc=convertir_texto.document)

    textos_para_embeber = []
    registros = []
    RUIDO = {"page_header", "page_footer"}

    for chunk in chunks:

        etiquetas = {item.label.value for item in chunk.meta.doc_items}
        if etiquetas and etiquetas <= RUIDO:
            continue

        texto = chunker.contextualize(chunk)
        if len(texto) < 100:
            continue

        # Operamos sobre un chunk y obtenemos los doc_items
        # Luego, para cada doc_item, obtenemos sus prov y extraemos el page_no 

        paginas = sorted(set(
            prov.page_no
            for item in chunk.meta.doc_items
            for prov in item.prov
        ))

        registros.append({
            "texto": texto,
            "nombre": chunk.meta.origin.filename,
            "texto_crudo": chunk.text,
            "headings": chunk.meta.headings or [],
            "paginas": list(paginas),
            "fecha": datetime.datetime.now().isoformat()
        })
        textos_para_embeber.append(f"passage: {texto}")

    return textos_para_embeber, registros

def embed_texts(chunks: list, embedder: str, qdrant, registros: list):
    vectores = np.array(list(embedder.embed(chunks)))

    if not qdrant.collection_exists(collection_name="Test_1"):
        qdrant.create_collection(
            collection_name="Test_1", 
            vectors_config=VectorParams(size= 1024, distance=Distance.COSINE))

    puntos = [
        PointStruct(
            id=id_desde_texto(registro["texto"]),
            vector=vector.tolist(),
            payload=registro
        )
        for i, (registro, vector) in enumerate(zip(registros, vectores))
    ]

    qdrant.upsert(
        collection_name="Test_1",
        points=puntos
    )