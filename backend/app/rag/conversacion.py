from app.db import record_crud
from app.core.excepcions import ConversacionNoEncontrada


def obtener_o_crear_conversacion(db, conversacion_id, query):
    if conversacion_id is None:
        titulo = query[:60].rsplit(" ", 1)[0] if len(query) > 60 else query
        return record_crud.crear_conversacion(db, titulo=titulo, usuario="default")

    conversacion = record_crud.obtener_conversacion(db, conversacion_id)
    if conversacion is None:
        raise ConversacionNoEncontrada(conversacion_id)
    return conversacion

