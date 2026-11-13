import datetime
import hashlib
import uuid
from qdrant_client.models import PointStruct, VectorParams, Distance, SparseVectorParams, models

from app.core.config import get_settings

COLLECTION_NAME = get_settings().qdrant_collection


def id_punto(documento_id: int, orden: int) -> str:
    """Id determinista del fragmento `orden` del documento `documento_id`.

    Antes era uuid5 sobre el texto, y dos documentos con un fragmento identico
    compartian punto: el segundo pisaba al primero. Sobre (documento, posicion)
    cada documento tiene sus puntos, y reindexar el mismo documento los
    sobrescribe en vez de duplicarlos.
    """
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{documento_id}:{orden}"))


def hash_texto(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def normalize_text(documento, chunker, file_path: str, name: str, type: str,
                   documento_id: int):
    """Trocea un DoclingDocument ya convertido.

    Recibe el documento y no el fichero: convertir es la parte cara, y quien
    llama lo necesita tambien para guardar su contenido completo, o lo carga
    del JSON guardado sin volver a convertir.
    """
    chunks = chunker.chunk(dl_doc=documento)

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
            "documento_id": documento_id,
            # Posicion entre los fragmentos que se guardan, no entre los que
            # devuelve el chunker: asi va de 0 a N-1 sin huecos.
            "orden": len(records),
            "hash_texto": hash_texto(chunk.text),
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
            "dense_vector": VectorParams(size=get_settings().dimension_densa, distance=Distance.COSINE)
        },
        sparse_vectors_config={
            "sparse_vector": SparseVectorParams(modifier=models.Modifier.IDF)
        },
    )
    # Sin indice, filtrar por documento_id (borrar un documento) recorre la
    # coleccion entera. hash_texto es para encontrar fragmentos repetidos.
    qdrant.create_payload_index(
        collection_name=COLLECTION_NAME,
        field_name="documento_id",
        field_schema=models.PayloadSchemaType.INTEGER,
    )
    qdrant.create_payload_index(
        collection_name=COLLECTION_NAME,
        field_name="hash_texto",
        field_schema=models.PayloadSchemaType.KEYWORD,
    )


def _punto(record: dict, denso, disperso) -> PointStruct:
    return PointStruct(
        id=id_punto(record["documento_id"], record["orden"]),
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


def borrar_por_documento(qdrant, documento_id: int) -> bool:
    """Borra los puntos de un documento. Devuelve False si la coleccion no
    existe o si el borrado falla, True en caso contrario.

    Filtra por documento_id y no por nombre ni por origen: dos ficheros con el
    mismo nombre en rutas distintas son documentos distintos.
    """
    try:
        if not qdrant.collection_exists(collection_name=COLLECTION_NAME):
            return False
        qdrant.delete(
            collection_name=COLLECTION_NAME,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="documento_id",
                            match=models.MatchValue(value=documento_id),
                        ),
                    ],
                )
            ),
        )
        return True
    except Exception as e:
        print(f"Error al borrar el documento {documento_id}: {e}")
        return False
