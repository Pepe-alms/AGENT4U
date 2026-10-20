from typing import Protocol, runtime_checkable


@runtime_checkable
class BackendClient(Protocol):
    async def obtener_ajustes(self) -> dict: ...
    async def close(self) -> None: ...
