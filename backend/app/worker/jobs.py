"""Funcion que ejecuta el worker de ARQ para indexar un documento.

El endpoint ya creo la fila en la BD (state="en-cola") y encolo el trabajo.
El worker lo recoge y lo indexa con `app.services.indexacion`, que marca
"indexando" y despues el resultado final ("indexado" o "error").

Es async porque ARQ la llama desde su event loop, pero el trabajo pesado
(Docling + embedders) es sincrono y corre en un hilo via `asyncio.to_thread`.
"""

from __future__ import annotations

import asyncio
import logging

from app.db.crud import document as document_crud
from app.db.session import SessionLocal
from app.services import document_service
from app.services.indexacion import indexar_documento

logger = logging.getLogger(__name__)


async def indexar_job(
    ctx: dict,
    job_id: str,
    file_path: str,
    type: str,
    size: int | None,
    resolucion: bool = False,
    reemplaza: int | None = None,
) -> None:
    # `type` y `size` ya no se usan (el tipo sale de la fila, que el endpoint
    # creo con el mismo valor), pero siguen en la firma: ARQ llama al job con
    # los argumentos con que se encolo, y puede haber trabajos en cola.
    # `resolucion` y `reemplaza` tienen valor por defecto por lo mismo: los
    # encolados antes de que existieran no los traen.
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
        # El usuario ya decidio indexarlo: desde el DoclingDocument que se
        # guardo al dejarlo pendiente, y sin volver a preguntar.
        desde_json=resolucion,
        comprobar_duplicados=not resolucion,
    )

    # 'Reemplazar': el antiguo se borra solo ahora, con el nuevo ya indexado.
    # Si la indexacion fallo, la excepcion ya ha salido de aqui y el antiguo
    # sigue intacto (y el nuevo, en error).
    if reemplaza is not None:
        await asyncio.to_thread(_borrar_reemplazado, reemplaza, ctx["qdrant"])


def _borrar_reemplazado(antiguo: int, qdrant) -> None:
    with SessionLocal() as sesion:
        if document_service.eliminar_documento(sesion, qdrant, antiguo) is None:
            # Qdrant no pudo borrar sus vectores: se quedan los dos, que es
            # mejor que perder alguno. Se puede borrar a mano despues.
            logger.warning("No se pudo borrar el documento %s al reemplazarlo", antiguo)
