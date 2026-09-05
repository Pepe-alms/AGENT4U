from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Annotated
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services import document_service

router = APIRouter()


@router.get(
    "/documentos",
    responses={500: {"description": "Error interno del servidor."},
               404: {"description": "Documentos no encontrados."}}
)
def listar(db: Annotated[Session, Depends(get_db)]):
    try:
        documentos = document_service.listar_documentos(db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not documentos:
        raise HTTPException(status_code=404, detail="No se encontraron documentos.")

    return {"documentos": documentos}


@router.delete(
    "/documentos/{documento}",
    responses={500: {"description": "Error interno del servidor."},
               404: {"description": "Documento no encontrado."}}
)
def eliminar(
    documento: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    try:
        resultado = document_service.eliminar_documento(db, qdrant=request.app.state.qdrant, nombre=documento)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if resultado is None:
        return {"status": "fallo en el borrado", "documento": documento}

    if not resultado:
        raise HTTPException(status_code=404, detail="Documento no encontrado.")

    return {"status": "eliminado", "documento": documento}
