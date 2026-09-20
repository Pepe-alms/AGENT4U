from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlalchemy.orm import Session

from app.api.schemas import (
    ConversacionDetalleOut,
    ConversacionEliminadaOut,
    ConversacionResumenOut,
    ErrorOut,
)
from app.db.session import get_db
from app.db.crud import conversation as conversation_crud

router = APIRouter(tags=["conversaciones"])


@router.get(
    "/conversaciones",
    response_model=list[ConversacionResumenOut],
    summary="Listar conversaciones",
    description="Las 20 conversaciones mas recientes del usuario, ordenadas "
                "por fecha de ultima actualizacion. Sin sus mensajes. "
                "Devuelve una lista vacia si no hay ninguna.",
)
def listar_conversaciones(
    db: Annotated[Session, Depends(get_db)]
):
    return conversation_crud.listar_conversaciones(db, usuario="local")


@router.delete(
    "/conversaciones/{conversacion_id}",
    response_model=ConversacionEliminadaOut,
    summary="Eliminar una conversacion",
    description="Borra la conversacion y, en cascada, todos sus mensajes.",
    responses={404: {"model": ErrorOut, "description": "Conversación no encontrada."}},
)
def eliminar_conversacion(
    conversacion_id: int,
    db: Annotated[Session, Depends(get_db)]
):
    if not conversation_crud.eliminar_conversacion(db, conversacion_id):
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    return {"status": "eliminada", "id": conversacion_id}


@router.get(
    "/conversaciones/{conversacion_id}",
    response_model=ConversacionDetalleOut,
    summary="Obtener una conversacion con sus mensajes",
    description="Devuelve la conversacion completa, con los mensajes ordenados "
                "del mas antiguo al mas reciente.",
    responses={404: {"model": ErrorOut, "description": "Conversación no encontrada."}},
)
def obtener_conversacion(conversacion_id: int, db: Annotated[Session, Depends(get_db)]):
    conv = conversation_crud.obtener_conversacion(db, conversacion_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    return conv
