from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Annotated
from sqlalchemy.orm import Session

from app.api.schemas import QueryRequest
from app.core.config import get_settings
from app.core.exceptions import ConversacionNoEncontrada
from app.db.session import get_db
from app.services.query_service import responder

router = APIRouter()


@router.post("/preguntar")
def preguntar(body: QueryRequest, request: Request, db: Annotated[Session, Depends(get_db)]):

    try:
        generador = responder(
            db=db,
            query=body.query,
            conversacion_id=body.conversacion_id,
            dense_embedder=request.app.state.dense_embedder,
            sparse_embedder=request.app.state.sparse_embedder,
            cross_encoder=request.app.state.cross_encoder,
            qdrant=request.app.state.qdrant,
            model=get_settings().llm_model,
            grafo=request.app.state.grafo,
        )
    except ConversacionNoEncontrada as e:
        raise HTTPException(status_code=404, detail=str(e))

    return StreamingResponse(generador, media_type="text/event-stream")
