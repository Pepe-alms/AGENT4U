from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.lifespan import lifespan
from app.api.routers import conversations, documents, indexation, query

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(query.router)
app.include_router(indexation.router)
app.include_router(documents.router)
app.include_router(conversations.router)
