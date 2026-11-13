from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Annotated
from sqlalchemy.orm import Session

from app.api.schemas import ContenidoDocumentoOut, DocumentoEliminadoOut, ErrorOut, ListaDocumentosOut
from app.core.exceptions import DocumentoNoEncontrado, NombreAmbiguo, SinContenidoGuardado
from app.services import contenidos
from app.db.session import get_db
from app.services import document_service

router = APIRouter(tags=["documentos"])


@router.get(
    "/documentos",
    response_model=ListaDocumentosOut,
    summary="Listar documentos indexados",
    description="Todos los documentos, del mas reciente al mas antiguo. "
                "Si no hay ninguno responde 404, no una lista vacia.",
    responses={404: {"model": ErrorOut, "description": "Documentos no encontrados."},
               500: {"model": ErrorOut, "description": "Error interno del servidor."}}
)
def listar(db: Annotated[Session, Depends(get_db)]):
    try:
        documentos = document_service.listar_documentos(db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not documentos:
        raise HTTPException(status_code=404, detail="No se encontraron documentos.")

    return {"documentos": documentos}


@router.get(
    "/documentos/{documento_id}/contenido",
    response_model=ContenidoDocumentoOut,
    summary="Leer el contenido completo de un documento",
    description="El Markdown que extrajo Docling al indexarlo y los datos "
                "basicos del documento. Aqui el parametro es el ID, no el "
                "nombre. 404 si el documento no existe; 409 si existe pero no "
                "tiene contenido guardado (indexado antes de que se guardara, "
                "todavia en cola o con la indexacion fallida).",
    responses={404: {"model": ErrorOut, "description": "El documento no existe."},
               409: {"model": ErrorOut, "description": "El documento existe pero no tiene contenido guardado."}}
)
def contenido(documento_id: int, db: Annotated[Session, Depends(get_db)]):
    try:
        doc, markdown = document_service.obtener_contenido(db, documento_id)
    except DocumentoNoEncontrado as e:
        raise HTTPException(status_code=404, detail=str(e))
    except SinContenidoGuardado as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"documento": doc, "markdown": markdown, "paginas": contenidos.contar_paginas(markdown)}


@router.delete(
    "/documentos/{documento}",
    response_model=DocumentoEliminadoOut,
    summary="Eliminar un documento",
    description="Borra los vectores del documento en Qdrant y despues su fila. "
                "El parametro es el NOMBRE del documento (campo 'name'), no su "
                "id. Si hay varios documentos con ese nombre responde 409 y no "
                "borra ninguno. Atencion: un 200 no garantiza el borrado; hay "
                "que mirar el campo 'status' de la respuesta.",
    responses={404: {"model": ErrorOut, "description": "Documento no encontrado."},
               409: {"model": ErrorOut, "description": "Varios documentos con ese nombre."},
               500: {"model": ErrorOut, "description": "Error interno del servidor."}}
)
def eliminar(
    documento: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    try:
        resultado = document_service.eliminar_documento(db, qdrant=request.app.state.qdrant, nombre=documento)
    except NombreAmbiguo as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if resultado is None:
        return {"status": "fallo en el borrado", "documento": documento}

    if not resultado:
        raise HTTPException(status_code=404, detail="Documento no encontrado.")

    return {"status": "eliminado", "documento": documento}
