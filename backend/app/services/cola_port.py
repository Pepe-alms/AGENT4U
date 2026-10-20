"""Puerto (interfaz) de la cola de indexacion.

La API habla con este Protocol, no con ARQ directamente. Para cambiar de
broker basta con escribir otra clase que lo implemente y conectarla en el
lifespan — los endpoints no se enteran.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class ColaIndexacion(Protocol):
    async def encolar(self, job_id: str, *, file_path: str, type: str,
                      size: int | None) -> None:
        """Mete un trabajo en la cola. No espera a que se procese."""
        ...

    async def en_vuelo(self) -> int:
        """Cuantos trabajos hay pendientes o ejecutandose."""
        ...

    async def close(self) -> None:
        """Libera recursos (conexiones, pools)."""
        ...


class ColaEnMemoria:
    """Doble para tests y para el arranque sin Redis.

    Guarda los trabajos encolados en una lista. No ejecuta nada: el test
    decide que hacer con lo que encuentra en `trabajos`.
    """

    def __init__(self) -> None:
        self.trabajos: list[dict] = []
        self._terminados: set[str] = set()

    async def encolar(self, job_id: str, *, file_path: str, type: str,
                      size: int | None) -> None:
        self.trabajos.append({
            "job_id": job_id,
            "file_path": file_path,
            "type": type,
            "size": size,
        })

    async def en_vuelo(self) -> int:
        return sum(1 for t in self.trabajos if t["job_id"] not in self._terminados)

    def marcar_terminado(self, job_id: str) -> None:
        self._terminados.add(job_id)

    async def close(self) -> None:
        self.trabajos.clear()
        self._terminados.clear()
