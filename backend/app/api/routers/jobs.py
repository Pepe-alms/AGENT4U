from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.schemas import ErrorOut, TrabajoEstadoOut
from app.db.crud import document as document_crud
from app.db.session import get_db

router = APIRouter(tags=["trabajos"])


@router.get(
    "/trabajos/{job_id}",
    response_model=TrabajoEstadoOut,
    responses={404: {"model": ErrorOut, "description": "Trabajo no encontrado."}},
    summary="Estado de un trabajo de indexacion",
)
def estado_trabajo(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
):
    doc = document_crud.obtener_por_job_id(db, job_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Trabajo no encontrado.")
    return TrabajoEstadoOut(
        job_id=doc.job_id,
        status=doc.state,
        origin=doc.origin,
        name=doc.name,
        num_chunks=doc.num_chunks,
        error_message=doc.error_message,
    )
