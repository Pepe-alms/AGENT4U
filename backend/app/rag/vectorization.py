import os
import uuid
import datetime
import numpy as np
from qdrant_client.models import PointStruct, VectorParams, Distance, SparseVectorParams, models

from app.core.config import get_settings

COLLECTION_NAME = get_settings().qdrant_collection


def id_from_text(text: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, text))

def normalize_text(file_path: str, converter, chunker, name: str, type: str):
    converted_document = converter.convert(file_path)
    chunks = chunker.chunk(dl_doc=converted_document.document)

    texts_to_embed = []
    records = []
    NOISE_LABELS = {"page_header", "page_footer"}

    for chunk in chunks:

        labels = {item.label.value for item in chunk.meta.doc_items}
        if labels and labels <= NOISE_LABELS:
            continue

        text = chunker.contextualize(chunk)
        if len(text) < 100:
            continue

        pages = sorted(set(
            prov.page_no
            for item in chunk.meta.doc_items
            for prov in item.prov
        ))

        records.append({
            "texto": text,
            "nombre": name,
            "origen": file_path,
            "texto_crudo": chunk.text,
            "headings": chunk.meta.headings or [],
            "paginas": list(pages),
            "tipo":type,
            "fecha": datetime.datetime.now().isoformat()
        })
        texts_to_embed.append(f"passage: {text}")

    return texts_to_embed, records

def embed_texts(chunks: list, dense_embedder: str, sparse_embedder: str, qdrant, records: list):
    dense_vectors = np.array(list(dense_embedder.embed(chunks)))
    sparse_vectors = np.array(list(sparse_embedder.embed(chunks)))


    if not qdrant.collection_exists(collection_name=COLLECTION_NAME):
        qdrant.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config={
                "dense_vector": VectorParams(size= 1024, distance=Distance.COSINE)
                },
            sparse_vectors_config={
                "sparse_vector": SparseVectorParams(modifier= models.Modifier.IDF)
                }
            )

    points = [
        PointStruct(
            id=id_from_text(record["texto"]),
            vector={
                "dense_vector": dense_vector.tolist(),
                "sparse_vector": models.SparseVector(
                    indices= sparse_vector.indices.tolist(),
                    values= sparse_vector.values.tolist()),
            },
            payload=record,
        )
        for record, dense_vector, sparse_vector in zip(records, dense_vectors, sparse_vectors)
    ]

    qdrant.upsert(
        collection_name=COLLECTION_NAME,
        points=points
    )

def borrar_por_origen(qdrant, origen: str) -> bool:
    """Borra los puntos cuyo campo 'origen' o 'nombre' coincida. Devuelve False
    si la coleccion no existe o si el borrado falla, True en caso contrario."""
    try:
        if not qdrant.collection_exists(collection_name=COLLECTION_NAME):
            return False
        qdrant.delete(
            collection_name=COLLECTION_NAME,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    should=[
                        models.FieldCondition(
                            key="origen",
                            match=models.MatchValue(value=origen),
                        ),
                        models.FieldCondition(
                            key="nombre",
                            match=models.MatchValue(value=origen),
                        ),
                    ],
                )
            ),
        )
        return True
    except Exception as e:
        print(f"Error al borrar por origen: {e}")
        return False