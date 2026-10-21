"""Implementacion de ColaIndexacion con ARQ + Redis."""

from __future__ import annotations

from arq import ArqRedis, create_pool
from arq.connections import RedisSettings

from app.db.crud import document as document_crud
from app.db.session import SessionLocal


class ColaArq:
    """Cola de trabajos de indexacion respaldada por Redis via ARQ."""

    def __init__(self, redis_url: str) -> None:
        self._redis_settings = RedisSettings.from_dsn(redis_url)
        self._pool: ArqRedis | None = None

    async def _get_pool(self) -> ArqRedis:
        if self._pool is None:
            self._pool = await create_pool(self._redis_settings)
        return self._pool

    async def encolar(self, job_id: str, *, file_path: str, type: str,
                      size: int | None) -> None:
        pool = await self._get_pool()
        await pool.enqueue_job(
            "indexar_job",
            job_id, file_path, type, size,
            _job_id=f"idx:{job_id}",
        )

    async def en_vuelo(self) -> int:
        with SessionLocal() as sesion:
            return document_crud.contar_en_vuelo(sesion)

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.aclose()
            self._pool = None
