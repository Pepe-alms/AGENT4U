from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.document import Document


def crear_documento(db: Session, origen: str, nombre: str, type: str,
                    size: int | None = None) -> Document:
    doc = Document(origin=origen, name=nombre, type=type,
                    size=size, state="pendiente")
    db.add(doc)
    db.commit()
    return doc


def marcar_indexado(db: Session, doc: Document, num_chunks: int) -> None:
    doc.state = "indexado"
    doc.num_chunks = num_chunks
    db.commit()


def marcar_error(db: Session, doc: Document, mensaje: str) -> None:
    doc.state = "error"
    doc.error_message = mensaje
    db.commit()


def listar_documentos(db: Session) -> list[Document]:
    return list(db.scalars(select(Document).order_by(Document.created_at.desc())))

def eliminar_documento(db: Session, name: str) -> bool:
    doc = db.scalar(select(Document).where(Document.name == name))
    if doc:
        db.delete(doc)
        db.commit()
        return True
    return False