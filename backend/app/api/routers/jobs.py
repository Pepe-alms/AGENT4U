from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.schemas import ErrorOut, TrabajoEstadoOut
from app.db.crud import document as document_crud
from app.db.models.document import Document
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
    # El otro documento del desenlace, para que quien sondea pueda decir con
    # cual coincide sin pedir la lista entera.
    otro_id = doc.duplicado_de if doc.state == "duplicado" else (
        doc.parecido_a if doc.state == "pendiente-decision" else None
    )
    otro = db.get(Document, otro_id) if otro_id is not None else None
    return TrabajoEstadoOut(
        job_id=doc.job_id,
        status=doc.state,
        origin=doc.origin,
        name=doc.name,
        num_chunks=doc.num_chunks,
        error_message=doc.error_message,
        documento_id=doc.id,
        relacionado={"id": otro.id, "name": otro.name, "state": otro.state} if otro else None,
        pct_nuevo_en_antiguo=doc.pct_nuevo_en_antiguo,
        pct_antiguo_en_nuevo=doc.pct_antiguo_en_nuevo,
    )
