import httpx


class HttpBackendClient:
    def __init__(self, base_url: str) -> None:
        self._client = httpx.AsyncClient(base_url=base_url, timeout=30)

    async def obtener_ajustes(self) -> dict:
        resp = await self._client.get("/ajustes")
        resp.raise_for_status()
        return resp.json()

    async def close(self) -> None:
        await self._client.aclose()
