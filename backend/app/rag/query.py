from app.db import record_crud
from conversacion import obtener_o_crear_conversacion
from generation import reformular_consulta, generate_response
from retrieval import search_chunks

def responder(db, query, conversacion_id, dense_embedder, sparse_embedder,
              cross_encoder, qdrant, model) -> dict:
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

    resultado = generate_response(
        query=query, chunks=chunks, historial=historial, model=model
    )

    record_crud.anadir_mensaje(
        db, conv.id, rol="assistant",
        contenido=resultado["respuesta"], fuentes=resultado["fuentes"],
    )

    return {**resultado, "conversacion_id": conv.id}