import os

from app.db.crud import document as document_crud
from app.core.exceptions import DocumentoYaExiste, FalloIngesta
from app.db.models.document import Document
from app.db.session import SessionLocal
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.rag.vectorization import embed_texts, normalize_text, borrar_por_origen


def _marcar_estado(doc_id: int, *, num_chunks: int | None = None,
                   mensaje: str | None = None) -> None:
    """Escribe el estado final del documento con una sesion propia.

    La sesion que inyecta FastAPI vive lo que vive la peticion. La indexacion,
    en cambio, corre en un hilo del threadpool y puede durar bastante mas: con
    un PDF de 176 paginas se pasa de la hora y media, y para entonces el
    cliente lleva un rato desconectado y el teardown de la dependencia ya ha
    cerrado esa sesion. Escribir el estado final por ahi es usar una sesion
    despues de su ciclo de vida, con su conexion ya devuelta al pool y
    posiblemente en manos de otra peticion.

    Que el hilo sobrevive a la peticion esta medido, no supuesto: un documento
    de 176 paginas seguia vectorizando a los noventa minutos, con el cliente
    caido desde el minuto diez.

    Es el mismo patron que ya usa `app/rag/streaming.py`, que persiste la
    respuesta cuando la peticion hace rato que termino.
    """
    with SessionLocal() as sesion:
        doc = sesion.get(Document, doc_id)
        if doc is None:
            # Lo borraron mientras se indexaba. No hay nada que marcar.
            return
        if mensaje is None:
            document_crud.marcar_indexado(sesion, doc, num_chunks)
        else:
            document_crud.marcar_error(sesion, doc, mensaje)


def indexar_documento(db: Session, file_path: str, converter, chunker, dense_embedder, sparse_embedder, qdrant, type, size: int):
    """Convierte, trocea, vectoriza e indexa un documento.

    **Es sincrono y tarda minutos.** Nunca debe llamarse desde una corrutina
    sin pasar por el threadpool: bloquearia el event loop y el proceso entero
    dejaria de responder, incluido /health.
    """
    origin = file_path
    name = os.path.basename(file_path)
    try:
        doc = document_crud.crear_documento(db, origin, name, type, size)
    except IntegrityError:
        db.rollback()
        raise DocumentoYaExiste(origin)

    # El entero, no el objeto: a partir de aqui la fila se toca desde otra
    # sesion, y el `doc` de esta puede haber quedado desligado.
    doc_id = doc.id

    try:
        chunks, records = normalize_text(file_path=file_path, converter=converter, chunker=chunker, name=name, type=type)
        embed_texts(chunks=chunks, dense_embedder=dense_embedder, sparse_embedder=sparse_embedder, qdrant=qdrant, records=records)
        _marcar_estado(doc_id, num_chunks=len(chunks))
        return {"status": "indexado", "num_chunks": len(chunks)}
    except Exception as e:
        borrar_por_origen(qdrant, origin)
        _marcar_estado(doc_id, mensaje=str(e))
        raise FalloIngesta(origin, str(e))


