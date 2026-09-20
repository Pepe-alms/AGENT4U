from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Annotated
from sqlalchemy.orm import Session

from app.api.schemas import ErrorOut, EventoStream, QueryRequest
from app.core.config import get_settings
from app.core.exceptions import ConversacionNoEncontrada
from app.db.session import get_db
from app.services.query_service import responder

class EventStreamResponse(StreamingResponse):
    """StreamingResponse con el media_type fijado, para que FastAPI documente
    la respuesta de /preguntar como 'text/event-stream' y no como JSON."""

    media_type = "text/event-stream"


router = APIRouter(tags=["consulta"])


@router.post(
    "/preguntar",
    response_class=EventStreamResponse,
    summary="Preguntar al agente (respuesta en streaming)",
    description=(
        "Responde con un stream Server-Sent Events, no con JSON. Cada evento "
        "llega como una linea `data: {...}` seguida de una linea en blanco, y "
        "su campo `tipo` indica cual de los modelos EventoInicio / "
        "EventoFuentes / EventoTexto / EventoError / EventoFin es.\n\n"
        "Orden garantizado: `inicio`, `fuentes`, N x `texto` y, para cerrar, "
        "`fin` (exito) o `error` (el modelo fallo a mitad). Los eventos "
        "`texto` son incrementales: hay que concatenarlos.\n\n"
        "Un fallo del modelo llega como evento `error` dentro de un stream con "
        "codigo HTTP 200, porque el codigo de estado ya se envio al abrirse la "
        "respuesta. El 404 solo se da antes de empezar el stream."
    ),
    responses={
        200: {
            "model": EventoStream,
            "description": "Stream SSE de eventos.",
            "content": {
                "text/event-stream": {
                    "example": (
                        'data: {"tipo": "inicio", "conversacion_id": 12345}\n\n'
                        'data: {"tipo": "fuentes", "fuentes": [{"nombre": "cap.pdf", '
                        '"origen": "/docs/cap.pdf", "headings": ["Teorema CAP"], '
                        '"paginas": [7]}]}\n\n'
                        'data: {"tipo": "texto", "texto": "El teorema CAP "}\n\n'
                        'data: {"tipo": "fin"}\n\n'
                    )
                }
            },
        },
        404: {"model": ErrorOut, "description": "Conversación no encontrada."},
    },
)
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
