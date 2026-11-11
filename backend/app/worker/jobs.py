"""Funcion que ejecuta el worker de ARQ para indexar un documento.

El endpoint ya creo la fila en la BD (state="en-cola") y encolo el trabajo.
El worker lo recoge y lo indexa con `app.services.indexacion`, que marca
"indexando" y despues el resultado final ("indexado" o "error").

Es async porque ARQ la llama desde su event loop, pero el trabajo pesado
(Docling + embedders) es sincrono y corre en un hilo via `asyncio.to_thread`.
"""

from __future__ import annotations

import asyncio

from app.db.crud import document as document_crud
from app.db.session import SessionLocal
from app.services.indexacion import indexar_documento


async def indexar_job(
    ctx: dict,
    job_id: str,
    file_path: str,
    type: str,
    size: int | None,
) -> None:
    # `type` y `size` ya no se usan (el tipo sale de la fila, que el endpoint
    # creo con el mismo valor), pero siguen en la firma: ARQ llama al job con
    # los argumentos con que se encolo, y puede haber trabajos en cola.
    with SessionLocal() as sesion:
        doc = document_crud.obtener_por_job_id(sesion, job_id)
        if doc is None:
            return
        doc_id = doc.id

    await asyncio.to_thread(
        indexar_documento,
        doc_id,
        file_path=file_path,
        converter=ctx["converter"],
        chunker=ctx["chunker"],
        dense_embedder=ctx["dense_embedder"],
        sparse_embedder=ctx["sparse_embedder"],
        qdrant=ctx["qdrant"],
    )
