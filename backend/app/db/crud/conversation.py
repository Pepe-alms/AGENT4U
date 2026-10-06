from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models.conversation import Conversacion, Mensaje

# Intentos ante colisión del id aleatorio de 5 cifras antes de rendirse.
_MAX_INTENTOS_ID = 5


def crear_conversacion(db: Session, titulo: str, usuario: str) -> Conversacion:
    for _ in range(_MAX_INTENTOS_ID):
        doc = Conversacion(titulo=titulo, usuario=usuario)
        db.add(doc)
        try:
            db.commit()
        except IntegrityError:
            # Id repetido: se descarta y se reintenta con otro.
            db.rollback()
            continue
        return doc
    raise RuntimeError("No se pudo asignar un id libre de 5 cifras a la conversación")

def obtener_conversacion(db: Session, conversacion_id: int) -> Conversacion | None:
    return db.scalar(select(Conversacion).where(Conversacion.id == conversacion_id))

def listar_conversaciones(db: Session, usuario: str, limit: int = 20) -> list[Conversacion]:
    return db.scalars(
        select(Conversacion)
        .where(Conversacion.usuario == usuario)
        .order_by(Conversacion.actualizada_en.desc())
        .limit(limit)
    ).all()

def renombrar_conversacion(db: Session, id: int, titulo: str) -> Conversacion | None:
    """Cambia el titulo y **conserva 'actualizada_en'**.

    La columna tiene onupdate, asi que por defecto un renombrado la pondria al
    dia y la conversacion saltaria al principio de la lista, que se ordena por
    esa fecha. Renombrar no es conversar, asi que se conserva.
    """
    conv = db.scalar(select(Conversacion).where(Conversacion.id == id))
    if conv is None:
        return None

    # UPDATE explicito con las dos columnas. Reasignar el atributo con su mismo
    # valor no sirve: SQLAlchemy no lo ve como un cambio, no lo mete en el SET
    # y entonces el onupdate hace su trabajo. Nombrando la columna en values()
    # se usa este valor y el onupdate no entra.
    db.execute(
        update(Conversacion)
        .where(Conversacion.id == id)
        .values(titulo=titulo, actualizada_en=conv.actualizada_en)
    )
    db.commit()
    db.refresh(conv)
    return conv


def eliminar_conversacion(db: Session, id: int) -> bool:
    conv = db.scalar(select(Conversacion).where(Conversacion.id == id))
    if conv:
        db.delete(conv)
        db.commit()
        return True
    return False

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

def obtener_ultimos_mensajes(db: Session, conv_id: int, limit: int = 5) -> list[Mensaje]:
    messages = db.scalars(
        select(Mensaje)
        .where(Mensaje.conversacion_id == conv_id)
        .order_by(Mensaje.creado_en.desc())
        .limit(limit)
    ).all()
    return list(reversed(messages))