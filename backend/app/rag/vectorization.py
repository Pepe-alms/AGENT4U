import uuid
import datetime
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

def asegurar_coleccion(qdrant) -> None:
    """Crea la coleccion si no existe.

    Se llama ANTES de vectorizar, no despues: si Qdrant esta caido conviene
    enterarse en el primer segundo y no tras varios minutos de CPU quemados en
    embeddings que no se van a poder guardar.
    """
    if qdrant.collection_exists(collection_name=COLLECTION_NAME):
        return

    qdrant.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config={
            "dense_vector": VectorParams(size=1024, distance=Distance.COSINE)
        },
        sparse_vectors_config={
            "sparse_vector": SparseVectorParams(modifier=models.Modifier.IDF)
        },
    )


def _punto(record: dict, denso, disperso) -> PointStruct:
    return PointStruct(
        id=id_from_text(record["texto"]),
        vector={
            "dense_vector": denso.tolist(),
            "sparse_vector": models.SparseVector(
                indices=disperso.indices.tolist(),
                values=disperso.values.tolist(),
            ),
        },
        payload=record,
    )


def embed_texts(chunks: list, dense_embedder, sparse_embedder, qdrant, records: list):
    """Vectoriza los fragmentos y los sube a Qdrant POR LOTES.

    La version anterior hacia `np.array(list(embedder.embed(chunks)))`, que
    materializa el documento entero vectorizado, y despues un unico `upsert`
    con todos los puntos. Dos problemas:

      1. Cada vector denso pasa por `.tolist()`, y una lista de 1024 floats de
         Python ocupa 32.824 bytes frente a los 4.096 del mismo vector en
         float32. Ocho veces mas, multiplicado por todos los fragmentos a la
         vez.
      2. Un solo cuerpo HTTP con todo dentro.

    Trabajando por lotes, en memoria solo hay `index_lote_upsert` puntos, sea
    el documento de diez paginas o de mil. El coste de los embeddings no
    cambia; lo que cambia es que deja de crecer con el tamaño del documento.
    """
    asegurar_coleccion(qdrant)

    tamano_lote = get_settings().index_lote_upsert

    # Generadores, no listas: lo que vectoriza es `zip`, fragmento a fragmento.
    densos = dense_embedder.embed(chunks)
    dispersos = sparse_embedder.embed(chunks)

    lote: list[PointStruct] = []
    for record, denso, disperso in zip(records, densos, dispersos):
        lote.append(_punto(record, denso, disperso))

        if len(lote) >= tamano_lote:
            qdrant.upsert(collection_name=COLLECTION_NAME, points=lote)
            lote = []

    if lote:
        qdrant.upsert(collection_name=COLLECTION_NAME, points=lote)


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