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


def crear_documento_encolado(db: Session, origen: str, nombre: str,
                             tipo: str, tamano: int | None,
                             job_id: str) -> Document:
    doc = Document(origin=origen, name=nombre, type=tipo,
                   size=tamano, state="en-cola", job_id=job_id)
    db.add(doc)
    db.commit()
    return doc


def obtener_por_job_id(db: Session, job_id: str) -> Document | None:
    return db.scalar(select(Document).where(Document.job_id == job_id))


def marcar_indexando(db: Session, doc: Document) -> None:
    doc.state = "indexando"
    db.commit()


def contar_en_vuelo(db: Session) -> int:
    return db.query(Document).filter(
        Document.state.in_(("en-cola", "indexando"))
    ).count()


def listar_documentos(db: Session) -> list[Document]:
    return list(db.scalars(select(Document).order_by(Document.created_at.desc())))

def eliminar_documento(db: Session, name: str) -> bool:
    doc = db.scalar(select(Document).where(Document.name == name))
    if doc:
        db.delete(doc)
        db.commit()
        return True
    return False