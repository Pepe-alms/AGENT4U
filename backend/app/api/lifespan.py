from contextlib import asynccontextmanager
from fastapi import FastAPI

## Modelos y QdrantClient

from qdrant_client import QdrantClient
from app.core.config import get_settings
from app.rag.modelos import crear_cross_encoder, crear_embedder_denso, crear_embedder_disperso

## SQL

from app.db.migrar import migrar

## Cola de indexacion

from app.services.cola_arq import ColaArq

## Grafo

from app.rag.grafo.grafo_create import crear_grafo



@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    app.state.dense_embedder = crear_embedder_denso(settings)
    app.state.sparse_embedder = crear_embedder_disperso(settings)
    app.state.cross_encoder = crear_cross_encoder(settings)
    app.state.qdrant = QdrantClient(url=settings.qdrant_url)

    # Docling (converter y chunker) no se carga aqui: la ingesta la hace el
    # worker, y ningun endpoint de la API los usa.

    # Antes que nada que toque la base: deja el esquema al dia.
    migrar()

    app.state.cola = ColaArq(settings.redis_url)

    app.state.grafo = crear_grafo(
        dense_embedder=app.state.dense_embedder,
        sparse_embedder=app.state.sparse_embedder,
        qdrant=app.state.qdrant,
        cross_encoder=app.state.cross_encoder,
        model=settings.llm_model,
    )

    yield
    await app.state.cola.close()
    app.state.qdrant.close()