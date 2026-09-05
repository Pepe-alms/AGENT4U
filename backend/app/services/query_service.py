from collections.abc import Iterator

from app.db.crud import conversation as conversation_crud
from app.core.exceptions import ConversacionNoEncontrada
from app.rag.streaming import responder_stream


def obtener_o_crear_conversacion(db, conversacion_id, query):
    if conversacion_id is None:
        titulo = query[:60].rsplit(" ", 1)[0] if len(query) > 60 else query
        return conversation_crud.crear_conversacion(db, titulo=titulo, usuario="local")

    conversacion = conversation_crud.obtener_conversacion(db, conversacion_id)
    if conversacion is None:
        raise ConversacionNoEncontrada(conversacion_id)
    return conversacion


def responder(db, query, conversacion_id, dense_embedder, sparse_embedder,
              cross_encoder, qdrant, model, grafo) -> Iterator[str]:

    conv = obtener_o_crear_conversacion(db, conversacion_id, query)
    historial = conversation_crud.obtener_ultimos_mensajes(db, conv.id, limit=6)
    conversation_crud.anadir_mensaje(db, conv.id, rol="user", contenido=query)

    estado = grafo.invoke(
        {
            "query": query,
            "historial": historial,
        }
    )

    return responder_stream(
        messages=estado["messages"],
        conversacion_id=conv.id,
        model=model,
        chunks=estado.get("chunks", []),
    )
