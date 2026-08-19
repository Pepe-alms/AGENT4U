## Paso 2 — importamos contextlib para poder usar el lifespan de FastAPI 
# y así poder inicializar la configuración de la aplicación. lifespan es un 
# contexto de vida de la aplicación que nos permite ejecutar código antes y después 
# de que la aplicación se inicie y se cierre.

# from contextlib import asynccontextmanager
# from fastapi import FastAPI
# from qdrant_client import AsyncQdrantClient

# from app.core.config import get_settings

# Como funciona este codigo:
# - Importamos asynccontextmanager de contextlib para crear un contexto de vida asíncrono.
# - Importamos FastAPI de fastapi para crear la aplicación web.
# - Importamos get_settings de core.config para obtener la configuración de la aplicación.
# - Creamos una función lifespan que recibe la aplicación FastAPI como parámetro.
# - Dentro de lifespan, obtenemos la configuración de la aplicación usando get_settings().
# - Creamos un cliente Qdrant asíncrono usando AsyncQdrantClient y la URL base de Qdrant obtenida de la configuración.
# - Usamos yield para indicar que el código antes de yield se ejecuta al iniciar la aplicación y el código después de yield se ejecuta al cerrar la aplicación.
# - Cerramos el cliente Qdrant asíncrono al finalizar la aplicación.

# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     settings = get_settings()
#     app.state.qdrant = AsyncQdrantClient(url=settings.qdrant_url)
#     yield
#     await app.state.qdrant.close()

# app = FastAPI(lifespan= lifespan)

# ## Paso 1 — app/main.py con un solo endpoint y cero configuración.
# # - Creas la instancia de FastAPI y un /health que devuelva un ok.
# # - Arrancas con uv run uvicorn app.main:app --reload

# @app.get("/health")
# async def health():
#     return {"status": "ok"}

# @app.get("/health/qdrant")
# async def health_qdrant():
#     try:
#         await app.state.qdrant.get_collections()
#         return {"status": "ok"}
#     except Exception as e:
#         return {"status": "error", "message": str(e)}



from fastapi import FastAPI, Request
from app.api.schemas import QueryRequest, IndexRequest
from app.api.app_state import lifespan
from app.core.config import get_settings
from app.retrieval.retrieval import search_chunks
from app.rag.generation import generate_response, build_context

from app.rag.indexation import embed_texts, normalize_text

app = FastAPI(lifespan=lifespan)

@app.post("/preguntar")
def preguntar(body: QueryRequest, request: Request):

    dense_embedder = request.app.state.dense_embedder
    sparse_embedder = request.app.state.sparse_embedder
    qdrant = request.app.state.qdrant

    cross_encoder = request.app.state.cross_encoder

    chunks = search_chunks(query=body.query, dense_embedder=dense_embedder, sparse_embedder=sparse_embedder, qdrant=qdrant, cross_encoder=cross_encoder)
    response = generate_response(query=body.query, chunks=chunks, model=get_settings().llm_model)
    return {"respuesta": response}


@app.post("/indexar")
def indexar(body: IndexRequest, request: Request):

    dense_embedder = request.app.state.dense_embedder
    sparse_embedder = request.app.state.sparse_embedder
    qdrant = request.app.state.qdrant
    converter = request.app.state.converter
    chunker = request.app.state.chunker


    chunks, records = normalize_text(file_path=body.file_path, converter=converter, chunker=chunker)
    embed_texts(chunks=chunks, dense_embedder=dense_embedder, sparse_embedder=sparse_embedder, qdrant=qdrant, records=records)



    return {"status": "indexado"}