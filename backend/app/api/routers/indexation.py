from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Annotated
from sqlalchemy.orm import Session

from app.api.schemas import ErrorOut, IndexRequest, IndexUrlRequest, IndexacionOut
from app.core.exceptions import DocumentoYaExiste, FalloIngesta
from app.db.session import get_db
from app.services.indexation_service import indexar_documento

router = APIRouter(tags=["indexacion"])


@router.post(
    "/indexar",
    response_model=IndexacionOut,
    summary="Indexar un fichero local",
    description="Convierte el fichero, lo trocea, vectoriza los fragmentos y "
                "los guarda en Qdrant. La ruta ('file_path') es unica: "
                "reindexar la misma devuelve 409. Si la ingesta falla a mitad "
                "se limpian los vectores ya escritos y el documento queda en "
                "estado 'error'.",
    responses={409: {"model": ErrorOut, "description": "Documento ya existe."},
               500: {"model": ErrorOut, "description": "Error en la ingesta del documento."}},
)
def indexar(
        body: IndexRequest,
        request: Request,
        db: Annotated[Session, Depends(get_db)],
    ):

    try:
        resultado = indexar_documento(
            db=db,
            file_path=body.file_path,
            converter=request.app.state.converter,
            chunker=request.app.state.chunker,
            dense_embedder=request.app.state.dense_embedder,
            sparse_embedder=request.app.state.sparse_embedder,
            qdrant=request.app.state.qdrant,
            size=body.size,
            type=body.type
        )
    except DocumentoYaExiste as e:
        raise HTTPException(status_code=409, detail=str(e))
    except FalloIngesta as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "indexado", **resultado}


@router.post(
    "/indexar-url",
    response_model=IndexacionOut,
    summary="Indexar una pagina web",
    description="Mismo flujo que POST /indexar, forzando type='url'. La URL "
                "es unica: reindexar la misma devuelve 409.",
    responses={409: {"model": ErrorOut, "description": "Documento ya existe."},
               500: {"model": ErrorOut, "description": "Error en la ingesta del documento."}},
)
def indexar_url(
    body: IndexUrlRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    ):

    try:
        resultado = indexar_documento(
            db=db,
            file_path=body.url,
            converter=request.app.state.converter,
            chunker=request.app.state.chunker,
            dense_embedder=request.app.state.dense_embedder,
            sparse_embedder=request.app.state.sparse_embedder,
            qdrant=request.app.state.qdrant,
            size=body.size,
            type="url"
        )
    except DocumentoYaExiste as e:
        raise HTTPException(status_code=409, detail=str(e))
    except FalloIngesta as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "indexado", **resultado}
