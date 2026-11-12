from sqlalchemy.orm import Session

from app.db.crud import document as document_crud
from app.core.exceptions import DocumentoNoEncontrado, NombreAmbiguo, SinContenidoGuardado
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


def eliminar_documento(db: Session, qdrant, nombre: str) -> bool | None:
    """Borra los vectores del documento y despues su fila.

    Devuelve False si no hay documento con ese nombre y None si Qdrant no pudo
    borrar (la fila se conserva para no dejar vectores huerfanos). Lanza
    NombreAmbiguo si hay mas de uno: se borra por documento_id, y el nombre
    tiene que señalar uno solo.
    """
    docs = document_crud.documentos_por_nombre(db, nombre)
    if not docs:
        return False
    if len(docs) > 1:
        raise NombreAmbiguo(nombre, len(docs))

    doc = docs[0]
    doc_id = doc.id
    if not borrar_por_documento(qdrant, doc_id):
        return None
    document_crud.eliminar_documento(db, doc)
    contenidos.borrar(doc_id)
    return True
