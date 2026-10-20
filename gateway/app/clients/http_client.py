import httpx

from app.clients.port import BackendHttpError


def _error_si_conflicto(resp: httpx.Response) -> None:
    if resp.status_code in (409, 429):
        detail = resp.json().get("detail", "")
        raise BackendHttpError(resp.status_code, detail)


class HttpBackendClient:
    def __init__(self, base_url: str) -> None:
        self._client = httpx.AsyncClient(base_url=base_url, timeout=30)

    # ── ajustes ──────────────────────────────────────────────────────

    async def obtener_ajustes(self) -> dict:
        resp = await self._client.get("/ajustes")
        resp.raise_for_status()
        return resp.json()

    # ── documentos ───────────────────────────────────────────────────

    async def obtener_documentos(self) -> list[dict]:
        resp = await self._client.get("/documentos")
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        return resp.json()["documentos"]

    async def eliminar_documento(self, nombre: str) -> dict:
        resp = await self._client.delete(f"/documentos/{nombre}")
        if resp.status_code == 404:
            raise BackendHttpError(404, resp.json().get("detail", ""))
        resp.raise_for_status()
        return resp.json()

    # ── trabajos ─────────────────────────────────────────────────────

    async def obtener_trabajo(self, job_id: str) -> dict | None:
        resp = await self._client.get(f"/trabajos/{job_id}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    # ── indexacion ───────────────────────────────────────────────────

    async def indexar(self, file_path: str, type: str, size: int | None) -> dict:
        body: dict = {"file_path": file_path, "type": type}
        if size is not None:
            body["size"] = size
        resp = await self._client.post("/indexar", json=body)
        _error_si_conflicto(resp)
        resp.raise_for_status()
        return resp.json()

    async def indexar_url(self, url: str, size: int | None) -> dict:
        body: dict = {"url": url}
        if size is not None:
            body["size"] = size
        resp = await self._client.post("/indexar-url", json=body)
        _error_si_conflicto(resp)
        resp.raise_for_status()
        return resp.json()

    # ── conversaciones ───────────────────────────────────────────────

    async def obtener_conversaciones(self) -> list[dict]:
        resp = await self._client.get("/conversaciones")
        resp.raise_for_status()
        return resp.json()

    async def obtener_conversacion(self, id: int) -> dict | None:
        resp = await self._client.get(f"/conversaciones/{id}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    async def eliminar_conversacion(self, id: int) -> dict:
        resp = await self._client.delete(f"/conversaciones/{id}")
        if resp.status_code == 404:
            raise BackendHttpError(404, resp.json().get("detail", ""))
        resp.raise_for_status()
        return resp.json()

    async def renombrar_conversacion(self, id: int, titulo: str) -> dict:
        resp = await self._client.patch(
            f"/conversaciones/{id}", json={"titulo": titulo}
        )
        if resp.status_code == 404:
            raise BackendHttpError(404, resp.json().get("detail", ""))
        resp.raise_for_status()
        return resp.json()

    # ── salud ────────────────────────────────────────────────────────

    async def salud(self) -> dict:
        resp = await self._client.get("/health")
        resp.raise_for_status()
        return resp.json()

    async def salud_qdrant(self) -> dict:
        resp = await self._client.get("/health/qdrant")
        resp.raise_for_status()
        return resp.json()

    # ── ciclo de vida ────────────────────────────────────────────────

    async def close(self) -> None:
        await self._client.aclose()
