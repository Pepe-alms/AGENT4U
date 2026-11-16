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
    doc.duplicado_de = None
    doc.parecido_a = None
    doc.pct_nuevo_en_antiguo = None
    doc.pct_antiguo_en_nuevo = None
    db.commit()


def marcar_pendiente_decision(db: Session, doc: Document, parecido_a: int,
                              pct_nuevo_en_antiguo: float,
                              pct_antiguo_en_nuevo: float) -> None:
    """Nivel 3: se parece demasiado a `parecido_a`. Espera a que el usuario
    decida; no se indexa hasta entonces."""
    doc.state = "pendiente-decision"
    doc.parecido_a = parecido_a
    doc.pct_nuevo_en_antiguo = pct_nuevo_en_antiguo
    doc.pct_antiguo_en_nuevo = pct_antiguo_en_nuevo
    doc.num_chunks = 0
    db.commit()


def volver_a_encolar(db: Session, doc: Document, job_id: str) -> None:
    """Tras resolver un pendiente de decision: a la cola con un trabajo nuevo."""
    doc.state = "en-cola"
    doc.job_id = job_id
    db.commit()


def ids_indexados(db: Session, ids: list[int]) -> set[int]:
    """De esos ids, los que son documentos indexados de verdad."""
    if not ids:
        return set()
    return set(db.scalars(
        select(Document.id).where(Document.id.in_(ids)).where(Document.state == "indexado")
    ))


def marcar_duplicado(db: Session, doc: Document, original_id: int) -> None:
    """Nivel 2: mismo contenido que `original_id`. No se indexa."""
    doc.state = "duplicado"
    doc.duplicado_de = original_id
    doc.num_chunks = 0
    db.commit()


# Los que cuentan como "ya existe ese contenido". Un documento en error no
# tiene nada en Qdrant, y uno duplicado apunta a su original.
ESTADOS_CON_CONTENIDO = ("en-cola", "indexando", "pendiente", "indexado", "pendiente-decision")


def con_mismo_texto(db: Session, hash_texto: str, salvo: int) -> Document | None:
    """Otro documento con la misma huella de texto, si lo hay."""
    return db.scalar(
        select(Document)
        .where(Document.hash_texto_normalizado == hash_texto)
        .where(Document.id != salvo)
        .where(Document.state.in_(ESTADOS_CON_CONTENIDO))
        .order_by(Document.id)
        .limit(1)
    )


def marcar_error(db: Session, doc: Document, mensaje: str) -> None:
    doc.state = "error"
    doc.error_message = mensaje
    db.commit()


def crear_documento_encolado(db: Session, origen: str, nombre: str,
                             tipo: str, tamano: int | None,
                             job_id: str, hash_content: str | None = None) -> Document:
    doc = Document(origin=origen, name=nombre, type=tipo,
                   size=tamano, state="en-cola", job_id=job_id,
                   hash_content=hash_content)
    db.add(doc)
    db.commit()
    return doc


def por_hash_content(db: Session, hash_content: str) -> Document | None:
    """El documento con esos mismos bytes, si lo hay. Si hay varios (bases
    antiguas, o uno en error y otro no), primero los que no estan en error."""
    return db.scalar(
        select(Document)
        .where(Document.hash_content == hash_content)
        .order_by(Document.state == "error", Document.id)
        .limit(1)
    )


def reintentar(db: Session, doc: Document, *, origen: str, nombre: str,
               job_id: str, hash_content: str) -> None:
    """Vuelve a encolar un documento en error con el mismo fichero.

    Si llega por otra ruta (otro nombre, u otra ruta en POST /indexar), pasa
    a apuntar a esa: es el fichero que se acaba de recibir y se sabe que
    existe. Lanza IntegrityError si esa ruta ya es de otro documento.
    """
    doc.origin = origen
    doc.name = nombre
    doc.state = "en-cola"
    doc.job_id = job_id
    doc.error_message = None
    doc.num_chunks = 0
    doc.hash_content = hash_content
    db.commit()


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

def eliminar_documento(db: Session, doc: Document) -> None:
    db.delete(doc)
    db.commit()