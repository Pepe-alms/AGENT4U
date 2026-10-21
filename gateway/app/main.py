from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from strawberry.fastapi import GraphQLRouter

from app.clients.http_client import HttpBackendClient
from app.config import get_settings
from app.proxy import router as proxy_router
from app.schema import schema


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.client = HttpBackendClient(settings.backend_url)
    app.state.proxy_client = httpx.AsyncClient(
        base_url=settings.backend_url, timeout=None
    )
    yield
    await app.state.client.close()
    await app.state.proxy_client.aclose()


async def get_context(request: Request) -> dict:
    return {"client": request.app.state.client}


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

graphql_router = GraphQLRouter(schema, context_getter=get_context)
app.include_router(graphql_router, prefix="/graphql")
app.include_router(proxy_router)
