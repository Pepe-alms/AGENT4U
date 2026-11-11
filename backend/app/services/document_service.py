from sqlalchemy.orm import Session

from app.db.crud import document as document_crud
from app.core.exceptions import NombreAmbiguo
from app.rag.vectorization import borrar_por_documento


def listar_documentos(db: Session):
    return document_crud.listar_documentos(db)


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
    if not borrar_por_documento(qdrant, doc.id):
        return None
    document_crud.eliminar_documento(db, doc)
    return True
