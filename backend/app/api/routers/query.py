from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Annotated
from sqlalchemy.orm import Session

from app.api.schemas import AjustesOut, ErrorOut, EventoStream, QueryRequest
from app.core.config import get_settings
from app.core.exceptions import ConversacionNoEncontrada
from app.db.session import get_db
from app.services.query_service import responder

class EventStreamResponse(StreamingResponse):
    """StreamingResponse con el media_type fijado, para que FastAPI documente
    la respuesta de /preguntar como 'text/event-stream' y no como JSON."""

    media_type = "text/event-stream"


router = APIRouter(tags=["consulta"])


def _modelos_permitidos() -> list[str]:
    """Lista blanca de APP_LLM_MODELOS, con el modelo por defecto siempre dentro."""
    settings = get_settings()
    modelos = [m.strip() for m in settings.llm_modelos.split(",") if m.strip()]
    if settings.llm_model not in modelos:
        modelos.insert(0, settings.llm_model)
    return modelos


@router.get(
    "/ajustes",
    response_model=AjustesOut,
    tags=["ajustes"],
    summary="Que parametros de consulta acepta el servidor",
    description="Lo que el cliente puede tocar en POST /preguntar. Existe para "
                "que la interfaz no duplique los limites del servidor ni se "
                "invente la lista de modelos.",
)
def ajustes():
    settings = get_settings()
    return {
        "modelos": _modelos_permitidos(),
        "max_fragmentos_defecto": settings.max_fragmentos_defecto,
        "max_fragmentos_tope": settings.max_fragmentos_tope,
    }


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
    settings = get_settings()

    # Lista blanca: aceptar cualquier cadena dejaria que el cliente apunte a un
    # modelo caro o inexistente, y el fallo saldria a mitad del stream.
    modelo = body.modelo or settings.llm_model
    if modelo not in _modelos_permitidos():
        raise HTTPException(
            status_code=422,
            detail=f"Modelo no permitido: {modelo}. Disponibles: {', '.join(_modelos_permitidos())}",
        )

    if body.max_fragmentos is not None and body.max_fragmentos > settings.max_fragmentos_tope:
        raise HTTPException(
            status_code=422,
            detail=f"max_fragmentos no puede pasar de {settings.max_fragmentos_tope}.",
        )

    try:
        generador = responder(
            db=db,
            query=body.query,
            conversacion_id=body.conversacion_id,
            dense_embedder=request.app.state.dense_embedder,
            sparse_embedder=request.app.state.sparse_embedder,
            cross_encoder=request.app.state.cross_encoder,
            qdrant=request.app.state.qdrant,
            model=modelo,
            grafo=request.app.state.grafo,
            max_fragmentos=body.max_fragmentos,
        )
    except ConversacionNoEncontrada as e:
        raise HTTPException(status_code=404, detail=str(e))

    return StreamingResponse(generador, media_type="text/event-stream")
