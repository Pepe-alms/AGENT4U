import pytest

from app.clients.port import BackendHttpError


class FakeBackendClient:
    """Doble del backend para los tests del gateway. Sin red, sin Docker."""

    def __init__(self) -> None:
        self.documentos: list[dict] = [
            {
                "id": 1,
                "origin": "/docs/cap.pdf",
                "name": "cap.pdf",
                "type": "pdf",
                "size": 1024,
                "created_at": "2026-01-01T00:00:00",
                "state": "indexado",
                "num_chunks": 12,
                "error_message": None,
            },
        ]
        self.conversaciones: list[dict] = [
            {
                "id": 54321,
                "titulo": "Teorema CAP",
                "creada_en": "2026-01-01T00:00:00",
                "actualizada_en": "2026-01-02T00:00:00",
            },
        ]
        self.trabajos: dict[str, dict] = {
            "abc-123": {
                "job_id": "abc-123",
                "status": "indexado",
                "origin": "/docs/cap.pdf",
                "name": "cap.pdf",
                "num_chunks": 12,
                "error_message": None,
            },
        }
        self.cupo_lleno = False

    # ── ajustes ──────────────────────────────────────────────────────

    async def obtener_ajustes(self) -> dict:
        return {
            "modelos": ["gemini/gemini-flash-lite-latest"],
            "max_fragmentos_defecto": 10,
            "max_fragmentos_tope": 20,
            "max_indexaciones_en_vuelo": 5,
        }

    # ── documentos ───────────────────────────────────────────────────

    async def obtener_documentos(self) -> list[dict]:
        return list(self.documentos)

    async def eliminar_documento(self, nombre: str) -> dict:
        for i, d in enumerate(self.documentos):
            if d["name"] == nombre:
                self.documentos.pop(i)
                return {"status": "eliminado", "documento": nombre}
        raise BackendHttpError(404, "Documento no encontrado.")

    # ── trabajos ─────────────────────────────────────────────────────

    async def obtener_trabajo(self, job_id: str) -> dict | None:
        return self.trabajos.get(job_id)

    # ── indexacion ───────────────────────────────────────────────────

    async def indexar(self, file_path: str, type: str, size: int | None) -> dict:
        if self.cupo_lleno:
            raise BackendHttpError(429, "Hay demasiados trabajos en cola o ejecutandose.")
        if any(d["origin"] == file_path for d in self.documentos):
            raise BackendHttpError(409, "Ya existe")
        return {"job_id": "fake-job-1", "status": "en-cola"}

    async def indexar_url(self, url: str, size: int | None) -> dict:
        if self.cupo_lleno:
            raise BackendHttpError(429, "Hay demasiados trabajos en cola o ejecutandose.")
        if url == "https://existe.com/ya-indexado":
            raise BackendHttpError(409, "Ya existe")
        return {"job_id": "fake-job-2", "status": "en-cola"}

    # ── conversaciones ───────────────────────────────────────────────

    async def obtener_conversaciones(self) -> list[dict]:
        return list(self.conversaciones)

    async def obtener_conversacion(self, id: int) -> dict | None:
        for c in self.conversaciones:
            if c["id"] == id:
                return {**c, "mensajes": []}
        return None

    async def eliminar_conversacion(self, id: int) -> dict:
        for i, c in enumerate(self.conversaciones):
            if c["id"] == id:
                self.conversaciones.pop(i)
                return {"status": "eliminada", "id": id}
        raise BackendHttpError(404, "Conversación no encontrada")

    async def renombrar_conversacion(self, id: int, titulo: str) -> dict:
        for c in self.conversaciones:
            if c["id"] == id:
                c["titulo"] = titulo
                return dict(c)
        raise BackendHttpError(404, "Conversación no encontrada")

    # ── salud ────────────────────────────────────────────────────────

    async def salud(self) -> dict:
        return {"status": "ok"}

    async def salud_qdrant(self) -> dict:
        return {
            "status": "ok",
            "coleccion": "Agent4U",
            "existe": True,
            "detalle": None,
        }

    # ── ciclo de vida ────────────────────────────────────────────────

    async def close(self) -> None:
        pass


@pytest.fixture
def fake_client():
    return FakeBackendClient()
