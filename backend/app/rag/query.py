from collections.abc import Iterator

from app.db import record_crud
from app.rag.conversacion import obtener_o_crear_conversacion
from app.rag.generation import reformular_consulta, generate_query
from app.rag.retrieval import search_chunks
from app.rag.streaming import responder_stream

def responder(db, query, conversacion_id, dense_embedder, sparse_embedder,
              cross_encoder, qdrant, model) -> Iterator[str]:
    conv = obtener_o_crear_conversacion(db, conversacion_id, query)

    historial = record_crud.obtener_ultimos_mensajes(db, conv.id, limit=6)

    record_crud.anadir_mensaje(db, conv.id, rol="user", contenido=query)

    consulta_busqueda = reformular_consulta(query, historial, model)

    chunks = search_chunks(
        query=consulta_busqueda,
        dense_embedder=dense_embedder,
        sparse_embedder=sparse_embedder,
        qdrant=qdrant,
        cross_encoder=cross_encoder,
    )

    return responder_stream(
        messages=generate_query(query, chunks, historial),
        conversacion_id=conv.id,
        model=model,
        chunks=chunks,
    )