import numpy as np
from qdrant_client.models import PointStruct, VectorParams, Distance, SparseVectorParams, models
import uuid
import datetime

def id_from_text(text: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, text))

def normalize_text(file_path: str, converter, chunker):
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

        # Operamos sobre un chunk y obtenemos los doc_items
        # Luego, para cada doc_item, obtenemos sus prov y extraemos el page_no

        pages = sorted(set(
            prov.page_no
            for item in chunk.meta.doc_items
            for prov in item.prov
        ))

        records.append({
            "texto": text,
            "nombre": chunk.meta.origin.filename,
            "texto_crudo": chunk.text,
            "headings": chunk.meta.headings or [],
            "paginas": list(pages),
            "fecha": datetime.datetime.now().isoformat()
        })
        texts_to_embed.append(f"passage: {text}")

    return texts_to_embed, records

def embed_texts(chunks: list, dense_embedder: str, sparse_embedder: str, qdrant, records: list):
    dense_vectors = np.array(list(dense_embedder.embed(chunks)))
    sparse_vectors = np.array(list(sparse_embedder.embed(chunks)))


    if not qdrant.collection_exists(collection_name="Test_1"):
        qdrant.create_collection(
            collection_name="Test_1",
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
        collection_name="Test_1",
        points=points
    )