import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
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


@router.post(
    "/indexar-fichero",
    response_model=FicheroSubidoOut,
    summary="Subir un fichero e indexarlo",
    description=(
        "Recibe el fichero en multipart/form-data, lo guarda en la carpeta de "
        "subidas (APP_UPLOAD_DIR) y aplica el mismo flujo que POST /indexar "
        "usando esa ruta como 'file_path'.\n\n"
        "El nombre lo elige el cliente, asi que se reduce a su ultimo "
        "componente: no se puede escribir fuera de la carpeta de subidas. "
        "Si ya hay un documento indexado con esa misma ruta responde 409, "
        "igual que POST /indexar."
    ),
    responses={
        400: {"model": ErrorOut, "description": "Nombre de fichero no valido o fichero vacio."},
        409: {"model": ErrorOut, "description": "Documento ya existe."},
        413: {"model": ErrorOut, "description": "El fichero supera APP_UPLOAD_MAX_BYTES."},
        500: {"model": ErrorOut, "description": "Error en la ingesta del documento."},
    },
)
async def indexar_fichero(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    fichero: Annotated[UploadFile, File(description="Fichero a indexar.")],
):
    settings = get_settings()
    carpeta = Path(settings.upload_dir)
    carpeta.mkdir(parents=True, exist_ok=True)

    destino = _ruta_segura(fichero.filename, carpeta)

    # Se escribe mientras se lee, comprobando el tamano sobre la marcha: fiarse
    # de la cabecera Content-Length dejaria pasar un cuerpo mas grande.
    escritos = 0
    try:
        with destino.open("wb") as salida:
            while trozo := await fichero.read(TROZO_BYTES):
                escritos += len(trozo)
                if escritos > settings.upload_max_bytes:
                    salida.close()
                    destino.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"El fichero supera el limite de "
                            f"{settings.upload_max_bytes} bytes."
                        ),
                    )
                salida.write(trozo)
    except HTTPException:
        raise
    except OSError as e:
        destino.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"No se pudo guardar el fichero: {e}")

    if escritos == 0:
        destino.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="El fichero esta vacio.")

    extension = destino.suffix.lstrip(".").lower() or "txt"

    try:
        resultado = indexar_documento(
            db=db,
            file_path=str(destino),
            converter=request.app.state.converter,
            chunker=request.app.state.chunker,
            dense_embedder=request.app.state.dense_embedder,
            sparse_embedder=request.app.state.sparse_embedder,
            qdrant=request.app.state.qdrant,
            size=escritos,
            type=extension,
        )
    except DocumentoYaExiste as e:
        # El fichero se queda: es el mismo que ya estaba indexado en esa ruta,
        # y borrarlo dejaria al documento existente apuntando a la nada.
        raise HTTPException(status_code=409, detail=str(e))
    except FalloIngesta as e:
        destino.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "indexado", **resultado, "ruta": str(destino)}
