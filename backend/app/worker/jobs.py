"""Funcion que ejecuta el worker de ARQ para indexar un documento.

El endpoint ya creo la fila en la BD (state="en-cola") y encolo el trabajo.
El worker lo recoge, marca "indexando", convierte, vectoriza y marca el
resultado final ("indexado" o "error").

Es async porque ARQ la llama desde su event loop, pero el trabajo pesado
(Docling + embedders) es sincrono y corre en un hilo via `asyncio.to_thread`.
"""

from __future__ import annotations

import asyncio

from app.db.crud import document as document_crud
from app.db.models.document import Document
from app.db.session import SessionLocal
from app.rag.vectorization import borrar_por_origen, embed_texts, normalize_text


async def indexar_job(
    ctx: dict,
    job_id: str,
    file_path: str,
    type: str,
    size: int | None,
) -> None:
    converter = ctx["converter"]
    chunker = ctx["chunker"]
    dense_embedder = ctx["dense_embedder"]
    sparse_embedder = ctx["sparse_embedder"]
    qdrant = ctx["qdrant"]

    with SessionLocal() as sesion:
        doc = document_crud.obtener_por_job_id(sesion, job_id)
        if doc is None:
            return
        document_crud.marcar_indexando(sesion, doc)
        doc_id = doc.id
        origin = doc.origin
        name = doc.name

    borrar_por_origen(qdrant, origin)

    def _trabajo():
        import os
        from app.rag.vectorization import embed_texts, normalize_text

        chunks, records = normalize_text(
            file_path=file_path, converter=converter,
            chunker=chunker, name=name, type=type,
        )
        embed_texts(
            chunks=chunks, dense_embedder=dense_embedder,
            sparse_embedder=sparse_embedder, qdrant=qdrant,
            records=records,
        )
        return len(chunks)

    try:
        num_chunks = await asyncio.to_thread(_trabajo)
    except Exception as e:
        borrar_por_origen(qdrant, origin)
        _marcar_estado_final(doc_id, mensaje=str(e))
        raise

    _marcar_estado_final(doc_id, num_chunks=num_chunks)


def _marcar_estado_final(doc_id: int, *, num_chunks: int | None = None,
                         mensaje: str | None = None) -> None:
    with SessionLocal() as sesion:
        doc = sesion.get(Document, doc_id)
        if doc is None:
            return
        if mensaje is None:
            document_crud.marcar_indexado(sesion, doc, num_chunks)
        else:
            document_crud.marcar_error(sesion, doc, mensaje)
