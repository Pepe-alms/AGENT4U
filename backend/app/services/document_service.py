from sqlalchemy.orm import Session

from app.db.crud import document as document_crud
import uuid

from app.core.exceptions import DocumentoNoEncontrado, SinContenidoGuardado, SinDecisionPendiente
from app.db.models.document import Document
from app.rag.vectorization import borrar_por_documento
from app.services import contenidos


def listar_documentos(db: Session):
    return document_crud.listar_documentos(db)


def obtener_contenido(db: Session, documento_id: int) -> tuple[Document, str]:
    """El documento y su Markdown completo.

    Lanza DocumentoNoEncontrado si no existe y SinContenidoGuardado si existe
    pero no tiene contenido (indexado antes de guardarlo, en cola, en error).
    """
    doc = db.get(Document, documento_id)
    if doc is None:
        raise DocumentoNoEncontrado(documento_id)
    markdown = contenidos.leer_markdown(documento_id)
    if markdown is None:
        raise SinContenidoGuardado(documento_id, doc.state)
    return doc, markdown


def eliminar_documento(db: Session, qdrant, documento_id: int) -> Document | None | bool:
    """Borra los vectores del documento y despues su fila y su contenido.

    Por id y no por nombre: el nombre no es unico (dos ficheros distintos
    pueden llamarse igual). Devuelve False si no existe, None si Qdrant no pudo
    borrar (la fila se conserva para no dejar vectores huerfanos) y el
    documento borrado si todo fue bien.
    """
    doc = db.get(Document, documento_id)
    if doc is None:
        return False
    doc_id = doc.id
    if not borrar_por_documento(qdrant, doc_id):
        return None
    document_crud.eliminar_documento(db, doc)
    contenidos.borrar(doc_id)
    return doc


async def resolver_pendiente(db: Session, qdrant, cola, documento_id: int, accion: str) -> dict:
    """La decision del usuario sobre un documento pendiente de decision.

    Nunca se llama sola: es lo que hace POST /documentos/{id}/resolver cuando
    el usuario elige. 'conservar' y 'reemplazar' lo encolan para indexarlo
    desde el DoclingDocument guardado (sin Docling y sin volver a comprobar
    duplicados); 'descartar' lo elimina.
    """
    doc = db.get(Document, documento_id)
    if doc is None:
        raise DocumentoNoEncontrado(documento_id)
    if doc.state != "pendiente-decision":
        raise SinDecisionPendiente(documento_id, doc.state)

    if accion == "descartar":
        # No tiene puntos en Qdrant: solo la fila y el JSON guardado.
        document_crud.eliminar_documento(db, doc)
        contenidos.borrar(documento_id)
        return {"id": documento_id, "accion": accion, "status": "descartado"}

    # Con 'reemplazar' el antiguo NO se borra aqui: lo borra el worker cuando
    # el nuevo ha quedado indexado. Si el encolado o la indexacion fallan, el
    # antiguo sigue intacto y el nuevo queda en error. Si el antiguo ya no
    # existe, no hay nada que reemplazar: se indexa sin mas.
    reemplaza = None
    if accion == "reemplazar" and doc.parecido_a is not None and db.get(Document, doc.parecido_a):
        reemplaza = doc.parecido_a

    job_id = str(uuid.uuid4())
    document_crud.volver_a_encolar(db, doc, job_id)
    await cola.encolar(job_id, file_path=doc.origin, type=doc.type, size=doc.size,
                       resolucion=True, reemplaza=reemplaza)
    return {"id": documento_id, "accion": accion, "status": "en-cola",
            "job_id": job_id, "reemplaza": reemplaza}
