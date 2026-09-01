from collections.abc import Iterator

from app.db import record_crud
from app.rag.conversacion import obtener_o_crear_conversacion
from app.rag.streaming import responder_stream

def responder(db, query, conversacion_id, dense_embedder, sparse_embedder,
              cross_encoder, qdrant, model, grafo) -> Iterator[str]:
    
    conv = obtener_o_crear_conversacion(db, conversacion_id, query)
    historial = record_crud.obtener_ultimos_mensajes(db, conv.id, limit=6)
    record_crud.anadir_mensaje(db, conv.id, rol="user", contenido=query)

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
