from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Annotated
from sqlalchemy.orm import Session

from app.api.schemas import IndexRequest, IndexUrlRequest
from app.core.exceptions import DocumentoYaExiste, FalloIngesta
from app.db.session import get_db
from app.services.indexation_service import indexar_documento

router = APIRouter()


@router.post(
    "/indexar",
    responses={409: {"description": "Documento ya existe."},
               500: {"description": "Error en la ingesta del documento."}},
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
    responses={409: {"description": "Documento ya existe."},
               500: {"description": "Error en la ingesta del documento."}},
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
