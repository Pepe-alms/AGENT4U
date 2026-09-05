from fastapi import FastAPI

from app.api.lifespan import lifespan
from app.api.routers import conversations, documents, indexation, query

app = FastAPI(lifespan=lifespan)

app.include_router(query.router)
app.include_router(indexation.router)
app.include_router(documents.router)
app.include_router(conversations.router)
