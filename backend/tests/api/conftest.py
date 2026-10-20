"""Fixtures propias de los tests de la capa HTTP.

El cliente se construye SIN 'with': asi no se dispara el lifespan y no se
descargan los modelos de embeddings ni se abre una conexion real a Qdrant.
Las dependencias pesadas se inyectan a mano en app.state y la sesion de base
de datos se sustituye con dependency_overrides.
"""
import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.core.config import get_settings
from app.db.session import get_db
from app.services.cola_port import ColaEnMemoria


@pytest.fixture
def client(session_factory, qdrant, converter, chunker,
           dense_embedder, sparse_embedder, grafo, llm):
    def _get_db():
        with session_factory() as sesion:
            yield sesion

    app.dependency_overrides[get_db] = _get_db
    app.state.qdrant = qdrant
    app.state.converter = converter
    app.state.chunker = chunker
    app.state.dense_embedder = dense_embedder
    app.state.sparse_embedder = sparse_embedder
    app.state.cross_encoder = None
    app.state.grafo = grafo
    app.state.cola = ColaEnMemoria()

    yield TestClient(app)

    app.dependency_overrides.clear()


@pytest.fixture
async def cliente_async(session_factory, qdrant, converter, chunker,
                        dense_embedder, sparse_embedder, grafo, llm):
    """El mismo montaje que `client`, pero sobre un event loop de verdad.

    `TestClient` es sincrono: cada peticion se ejecuta y se espera, asi que no
    sirve para comprobar si el servidor atiende dos cosas a la vez. Y eso es
    justo lo que hay que medir en la indexacion.
    """
    import httpx

    def _get_db():
        with session_factory() as sesion:
            yield sesion

    app.dependency_overrides[get_db] = _get_db
    app.state.qdrant = qdrant
    app.state.converter = converter
    app.state.chunker = chunker
    app.state.dense_embedder = dense_embedder
    app.state.sparse_embedder = sparse_embedder
    app.state.cross_encoder = None
    app.state.grafo = grafo
    app.state.cola = ColaEnMemoria()

    transporte = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transporte, base_url="http://pruebas") as cliente:
        yield cliente

    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def carpeta_subidas(tmp_path, monkeypatch):
    """Las subidas van a una carpeta temporal, nunca a la del proyecto.

    Autouse para que ningun test de esta capa pueda ensuciar `uploads/` ni
    pisar un fichero que ya este indexado de verdad.
    """
    carpeta = tmp_path / "uploads"
    monkeypatch.setattr(get_settings(), "upload_dir", str(carpeta))
    return carpeta
