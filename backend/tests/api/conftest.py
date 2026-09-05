"""Fixtures propias de los tests de la capa HTTP.

El cliente se construye SIN 'with': asi no se dispara el lifespan y no se
descargan los modelos de embeddings ni se abre una conexion real a Qdrant.
Las dependencias pesadas se inyectan a mano en app.state y la sesion de base
de datos se sustituye con dependency_overrides.
"""
import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.db.session import get_db


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

    yield TestClient(app)

    app.dependency_overrides.clear()
