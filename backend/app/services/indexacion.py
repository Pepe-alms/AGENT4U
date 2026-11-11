"""El unico camino para indexar un documento que ya tiene fila en la BD.

Lo usan el worker de ARQ, los scripts de evaluacion y el de reindexado. Antes
habia dos copias (el worker e `indexation_service`), y cada arreglo habia que
hacerlo dos veces.

**Es sincrono y tarda minutos**: quien lo llame desde una corrutina tiene que
pasarlo por un hilo (`asyncio.to_thread`), o bloquea el event loop.
"""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import DocumentoYaExiste
from app.db.crud import document as document_crud
from app.db.models.document import Document
from app.db.session import SessionLocal
from app.rag.vectorization import borrar_por_documento, embed_texts, normalize_text


def registrar_documento(db: Session, origen: str, nombre: str, tipo: str,
                        tamano: int | None = None) -> int:
    """Crea la fila de un documento para indexarlo despues sin cola.

    Es lo que hacen los scripts de evaluacion; la API crea la suya con
    `crear_documento_encolado`. El origen es unico: si ya existe, lanza
    DocumentoYaExiste.
    """
    try:
        doc = document_crud.crear_documento(db, origen, nombre, tipo, tamano)
    except IntegrityError:
        db.rollback()
        raise DocumentoYaExiste(origen)
    return doc.id


def indexar_documento(doc_id: int, *, file_path: str, converter, chunker,
                      dense_embedder, sparse_embedder, qdrant) -> int | None:
    """Convierte, trocea, vectoriza y sube a Qdrant el documento `doc_id`.

    Marca 'indexando' al empezar y 'indexado' o 'error' al terminar. Devuelve
    el numero de fragmentos, o None si la fila ya no existe (la borraron
    mientras esperaba). Si falla, borra lo que llegara a subir, marca el error
    y relanza la excepcion.

    Cada escritura de estado abre su propia sesion: esto corre en un hilo que
    puede durar mas que la peticion o el job que lo lanzo.
    """
    with SessionLocal() as sesion:
        doc = sesion.get(Document, doc_id)
        if doc is None:
            return None
        document_crud.marcar_indexando(sesion, doc)
        nombre = doc.name
        tipo = doc.type

    # Lo que hubiera de una indexacion anterior se va antes de subir lo nuevo.
    # Los ids son por (documento, posicion), asi que el upsert ya sobrescribe,
    # pero si el documento tiene ahora menos fragmentos sobrarian los del final.
    borrar_por_documento(qdrant, doc_id)

    try:
        chunks, records = normalize_text(
            file_path=file_path, converter=converter, chunker=chunker,
            name=nombre, type=tipo, documento_id=doc_id,
        )
        embed_texts(
            chunks=chunks, dense_embedder=dense_embedder,
            sparse_embedder=sparse_embedder, qdrant=qdrant, records=records,
        )
    except Exception as e:
        borrar_por_documento(qdrant, doc_id)
        _marcar_estado_final(doc_id, mensaje=str(e))
        raise

    _marcar_estado_final(doc_id, num_chunks=len(chunks))
    return len(chunks)


def _marcar_estado_final(doc_id: int, *, num_chunks: int | None = None,
                         mensaje: str | None = None) -> None:
    with SessionLocal() as sesion:
        doc = sesion.get(Document, doc_id)
        if doc is None:
            # Lo borraron mientras se indexaba. No hay nada que marcar.
            return
        if mensaje is None:
            document_crud.marcar_indexado(sesion, doc, num_chunks)
        else:
            document_crud.marcar_error(sesion, doc, mensaje)
