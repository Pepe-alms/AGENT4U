from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.record_model import Conversacion, Mensaje


def crear_conversacion(db: Session, titulo: str, usuario: str, mensajes: list[Mensaje]) -> Conversacion:
    doc = Conversacion(titulo=titulo, usuario=usuario, mensajes=mensajes)
    db.add(doc)
    db.commit()
    return doc


def anadir_mensaje(db: Session, conversacion_id: int, rol: str,
                   contenido: str, fuentes: list | None = None) -> Mensaje:
    mensaje = Mensaje(
        conversacion_id=conversacion_id,
        rol=rol,
        contenido=contenido,
        fuentes=fuentes,
    )
    db.add(mensaje)
    db.commit()
    return mensaje

def eliminar_conversacion(db: Session, titulo: str, id: int) -> bool:
    conv = db.scalar(select(Conversacion).where(Conversacion.titulo == titulo, Conversacion.id == id))
    if conv:
        db.delete(conv)
        db.commit()
        return True
    return False

def obtener_ultimos_mensajes(db: Session, conv_id: int, limit: int = 5) -> list[Mensaje]:
    messages = db.scalars(
        select(Mensaje)
        .where(Mensaje.conversacion_id == conv_id)
        .order_by(Mensaje.creado_en.desc())
        .limit(limit)
    ).all()
    return list(reversed(messages))

def listar_conversaciones(db: Session, usuario: str) -> list[Conversacion]:
    return db.scalars(
        select(Conversacion).where(Conversacion.usuario == usuario).order_by(Conversacion.actualizada_en.desc())
    ).all()

def listar_mensajes(db: Session, conv: Conversacion) -> list[Mensaje]:
    return db.scalars(
        select(Mensaje).where(Mensaje.conversacion_id == conv.id).order_by(Mensaje.creado_en)
    ).all()