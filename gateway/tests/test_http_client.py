import httpx
import pytest

from app.clients.http_client import HttpBackendClient
from app.clients.port import BackendHttpError


DOCUMENTO = {
    "id": 1,
    "origin": "/docs/cap.pdf",
    "name": "cap.pdf",
    "type": "pdf",
    "size": 1024,
    "created_at": "2026-01-01T00:00:00",
    "state": "indexado",
    "num_chunks": 12,
    "error_message": None,
}

TRABAJO = {
    "job_id": "abc-123",
    "status": "indexado",
    "origin": "/docs/cap.pdf",
    "name": "cap.pdf",
    "num_chunks": 12,
    "error_message": None,
}

CONVERSACION_RESUMEN = {
    "id": 54321,
    "titulo": "Teorema CAP",
    "creada_en": "2026-01-01T00:00:00",
    "actualizada_en": "2026-01-02T00:00:00",
}


def _hacer_cliente(handler) -> HttpBackendClient:
    """Crea un HttpBackendClient con transporte ficticio (sin red)."""
    transport = httpx.MockTransport(handler)
    cliente = HttpBackendClient.__new__(HttpBackendClient)
    cliente._client = httpx.AsyncClient(
        transport=transport, base_url="http://test"
    )
    return cliente


# ── obtener_documentos ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_obtener_documentos_200_devuelve_lista():
    def handler(request):
        return httpx.Response(200, json={"documentos": [DOCUMENTO]})

    docs = await _hacer_cliente(handler).obtener_documentos()
    assert len(docs) == 1
    assert docs[0]["name"] == "cap.pdf"


@pytest.mark.asyncio
async def test_obtener_documentos_404_devuelve_lista_vacia():
    def handler(request):
        return httpx.Response(404, json={"detail": "No se encontraron documentos."})

    assert await _hacer_cliente(handler).obtener_documentos() == []


# ── eliminar_documento ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_eliminar_documento_200():
    def handler(request):
        return httpx.Response(
            200, json={"status": "eliminado", "documento": "cap.pdf"}
        )

    res = await _hacer_cliente(handler).eliminar_documento("cap.pdf")
    assert res["status"] == "eliminado"


@pytest.mark.asyncio
async def test_eliminar_documento_404_lanza_error():
    def handler(request):
        return httpx.Response(404, json={"detail": "Documento no encontrado."})

    with pytest.raises(BackendHttpError) as exc:
        await _hacer_cliente(handler).eliminar_documento("fantasma.pdf")
    assert exc.value.status == 404


# ── obtener_trabajo ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_obtener_trabajo_200():
    def handler(request):
        return httpx.Response(200, json=TRABAJO)

    res = await _hacer_cliente(handler).obtener_trabajo("abc-123")
    assert res["job_id"] == "abc-123"
    assert res["status"] == "indexado"


@pytest.mark.asyncio
async def test_obtener_trabajo_404_devuelve_none():
    def handler(request):
        return httpx.Response(404, json={"detail": "Trabajo no encontrado."})

    assert await _hacer_cliente(handler).obtener_trabajo("xyz") is None


# ── indexar ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_indexar_202():
    def handler(request):
        return httpx.Response(202, json={"job_id": "nuevo-1", "status": "en-cola"})

    res = await _hacer_cliente(handler).indexar("/docs/x.pdf", "pdf", 1024)
    assert res["job_id"] == "nuevo-1"


@pytest.mark.asyncio
async def test_indexar_409_lanza_error():
    def handler(request):
        return httpx.Response(409, json={"detail": "Ya existe"})

    with pytest.raises(BackendHttpError) as exc:
        await _hacer_cliente(handler).indexar("/docs/x.pdf", "pdf", None)
    assert exc.value.status == 409


@pytest.mark.asyncio
async def test_indexar_429_lanza_error():
    def handler(request):
        return httpx.Response(429, json={"detail": "Demasiados"})

    with pytest.raises(BackendHttpError) as exc:
        await _hacer_cliente(handler).indexar("/docs/x.pdf", "pdf", None)
    assert exc.value.status == 429


# ── indexar_url ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_indexar_url_202():
    def handler(request):
        return httpx.Response(202, json={"job_id": "url-1", "status": "en-cola"})

    res = await _hacer_cliente(handler).indexar_url("https://ejemplo.com", None)
    assert res["job_id"] == "url-1"


@pytest.mark.asyncio
async def test_indexar_url_409_lanza_error():
    def handler(request):
        return httpx.Response(409, json={"detail": "Ya existe"})

    with pytest.raises(BackendHttpError) as exc:
        await _hacer_cliente(handler).indexar_url("https://ejemplo.com", None)
    assert exc.value.status == 409


# ── obtener_conversaciones ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_obtener_conversaciones_200():
    def handler(request):
        return httpx.Response(200, json=[CONVERSACION_RESUMEN])

    convs = await _hacer_cliente(handler).obtener_conversaciones()
    assert len(convs) == 1
    assert convs[0]["titulo"] == "Teorema CAP"


# ── obtener_conversacion ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_obtener_conversacion_200():
    def handler(request):
        return httpx.Response(
            200,
            json={**CONVERSACION_RESUMEN, "mensajes": []},
        )

    res = await _hacer_cliente(handler).obtener_conversacion(54321)
    assert res["id"] == 54321


@pytest.mark.asyncio
async def test_obtener_conversacion_404_devuelve_none():
    def handler(request):
        return httpx.Response(404, json={"detail": "Conversación no encontrada"})

    assert await _hacer_cliente(handler).obtener_conversacion(99999) is None


# ── eliminar_conversacion ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_eliminar_conversacion_200():
    def handler(request):
        return httpx.Response(200, json={"status": "eliminada", "id": 54321})

    res = await _hacer_cliente(handler).eliminar_conversacion(54321)
    assert res["status"] == "eliminada"


@pytest.mark.asyncio
async def test_eliminar_conversacion_404_lanza_error():
    def handler(request):
        return httpx.Response(404, json={"detail": "Conversación no encontrada"})

    with pytest.raises(BackendHttpError) as exc:
        await _hacer_cliente(handler).eliminar_conversacion(99999)
    assert exc.value.status == 404


# ── renombrar_conversacion ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_renombrar_conversacion_200():
    def handler(request):
        return httpx.Response(200, json=CONVERSACION_RESUMEN)

    res = await _hacer_cliente(handler).renombrar_conversacion(54321, "Nuevo titulo")
    assert res["titulo"] == "Teorema CAP"


@pytest.mark.asyncio
async def test_renombrar_conversacion_404_lanza_error():
    def handler(request):
        return httpx.Response(404, json={"detail": "Conversación no encontrada"})

    with pytest.raises(BackendHttpError) as exc:
        await _hacer_cliente(handler).renombrar_conversacion(99999, "Da igual")
    assert exc.value.status == 404


# ── salud ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_salud_200():
    def handler(request):
        return httpx.Response(200, json={"status": "ok"})

    res = await _hacer_cliente(handler).salud()
    assert res["status"] == "ok"


# ── salud_qdrant ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_salud_qdrant_200():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "status": "ok",
                "coleccion": "Agent4U",
                "existe": True,
                "detalle": None,
            },
        )

    res = await _hacer_cliente(handler).salud_qdrant()
    assert res["status"] == "ok"
    assert res["coleccion"] == "Agent4U"
