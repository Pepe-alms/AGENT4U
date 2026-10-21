import httpx
import pytest
from httpx import ASGITransport

from app.main import app


def _backend_falso(handler) -> httpx.AsyncClient:
    """AsyncClient con transporte ficticio que simula al backend real."""
    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport, base_url="http://backend-fake")


# ── /preguntar (SSE) ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_preguntar_reenvia_el_stream_sse():
    def handler(request):
        cuerpo = (
            b'data: {"tipo": "inicio", "conversacion_id": 1}\n\n'
            b'data: {"tipo": "texto", "texto": "Hola"}\n\n'
            b'data: {"tipo": "fin"}\n\n'
        )
        return httpx.Response(
            200, content=cuerpo, headers={"content-type": "text/event-stream"}
        )

    app.state.proxy_client = _backend_falso(handler)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://gw"
    ) as cliente:
        async with cliente.stream(
            "POST", "/preguntar", json={"query": "hola"}
        ) as resp:
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")
            recibido = b""
            async for trozo in resp.aiter_bytes():
                recibido += trozo

    assert b'"tipo": "inicio"' in recibido
    assert b'"tipo": "fin"' in recibido


@pytest.mark.asyncio
async def test_preguntar_404_antes_de_empezar_el_stream_se_propaga():
    def handler(request):
        return httpx.Response(
            404, json={"detail": "Conversación no encontrada"}
        )

    app.state.proxy_client = _backend_falso(handler)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://gw"
    ) as cliente:
        resp = await cliente.post(
            "/preguntar", json={"query": "hola", "conversacion_id": 999}
        )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Conversación no encontrada"


# ── /indexar-fichero (multipart) ───────────────────────────────────────


@pytest.mark.asyncio
async def test_indexar_fichero_reenvia_el_multipart():
    recibido = {}

    def handler(request):
        recibido["content_type"] = request.headers.get("content-type", "")
        recibido["body"] = request.content
        return httpx.Response(
            202,
            json={"job_id": "job-1", "status": "en-cola", "ruta": "/uploads/x.txt"},
        )

    app.state.proxy_client = _backend_falso(handler)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://gw"
    ) as cliente:
        resp = await cliente.post(
            "/indexar-fichero",
            files={"fichero": ("x.txt", b"contenido del fichero", "text/plain")},
        )

    assert resp.status_code == 202
    assert resp.json()["job_id"] == "job-1"
    assert b"contenido del fichero" in recibido["body"]
    assert "multipart/form-data" in recibido["content_type"]


@pytest.mark.asyncio
async def test_indexar_fichero_429_reenvia_retry_after():
    def handler(request):
        return httpx.Response(
            429,
            json={"detail": "Hay demasiados trabajos en cola o ejecutandose."},
            headers={"retry-after": "120"},
        )

    app.state.proxy_client = _backend_falso(handler)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://gw"
    ) as cliente:
        resp = await cliente.post(
            "/indexar-fichero",
            files={"fichero": ("x.txt", b"contenido", "text/plain")},
        )

    assert resp.status_code == 429
    assert resp.headers["retry-after"] == "120"
