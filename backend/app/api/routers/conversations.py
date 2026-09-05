from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlalchemy.orm import Session

from app.api.schemas import ConversacionResumenOut, ConversacionDetalleOut
from app.db.session import get_db
from app.db.crud import conversation as conversation_crud

router = APIRouter()


@router.get(
    "/conversaciones",
    response_model=list[ConversacionResumenOut])
def listar_conversaciones(
    db: Annotated[Session, Depends(get_db)]
):
    return conversation_crud.listar_conversaciones(db, usuario="local")


@router.delete(
    "/conversaciones/{conversacion_id}",
    responses={404: {"description": "Conversación no encontrada."}},
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
    responses={404: {"description": "Conversación no encontrada."}},
)
def obtener_conversacion(conversacion_id: int, db: Annotated[Session, Depends(get_db)]):
    conv = conversation_crud.obtener_conversacion(db, conversacion_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    return conv
