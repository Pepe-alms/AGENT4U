from sqlalchemy.orm import Session

from app.db.crud import document as document_crud
from app.rag.vectorization import borrar_por_origen


def listar_documentos(db: Session):
    return document_crud.listar_documentos(db)


def eliminar_documento(db: Session, qdrant, nombre: str) -> bool | None:
    if not borrar_por_origen(qdrant=qdrant, origen=nombre):
        return None
    return document_crud.eliminar_documento(db, nombre)
