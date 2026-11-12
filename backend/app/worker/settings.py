"""Configuracion del worker de ARQ.

ARQ necesita una clase con ciertos atributos para arrancar el worker.
`on_startup` carga los modelos pesados (Docling, embedders, QdrantClient)
una sola vez y los guarda en `ctx`, que ARQ pasa a cada job.
"""

from arq.connections import RedisSettings

from app.core.config import get_settings
from app.worker.jobs import indexar_job


async def startup(ctx: dict) -> None:
    """Carga los modelos al arrancar. Solo se ejecuta una vez."""
    from qdrant_client import QdrantClient

    from app.rag.modelos import (
        crear_chunker, crear_converter, crear_embedder_denso, crear_embedder_disperso,
    )

    from app.db.migrar import migrar

    settings = get_settings()

    # El worker escribe en la base aunque la API no haya arrancado todavia.
    migrar()

    ctx["dense_embedder"] = crear_embedder_denso(settings)
    ctx["sparse_embedder"] = crear_embedder_disperso(settings)
    ctx["qdrant"] = QdrantClient(url=settings.qdrant_url)
    ctx["converter"] = crear_converter()
    ctx["chunker"] = crear_chunker(settings)


async def shutdown(ctx: dict) -> None:
    qdrant = ctx.get("qdrant")
    if qdrant is not None:
        qdrant.close()


class WorkerSettings:
    functions = [indexar_job]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = get_settings().index_max_concurrentes
    job_timeout = 7200
    on_startup = startup
    on_shutdown = shutdown
