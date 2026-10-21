import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from typing import Annotated
from sqlalchemy.orm import Session

from app.api.schemas import (
    ErrorOut,
    FicheroEncoladoOut,
    IndexRequest,
    IndexUrlRequest,
    TrabajoEncoladoOut,
)
from app.core.config import get_settings
from app.core.exceptions import DocumentoYaExiste
from app.db.crud import document as document_crud
from app.db.session import get_db
from app.services.cola_port import ColaIndexacion

router = APIRouter(tags=["indexacion"])

REINTENTAR_EN = 120

RESPUESTAS_COMUNES = {
    409: {"model": ErrorOut, "description": "Documento ya existe."},
    429: {
        "model": ErrorOut,
        "description": (
            "Hay demasiados trabajos en cola o ejecutandose. Se responde "
            "con la cabecera Retry-After."
        ),
    },
}

TROZO_BYTES = 1024 * 1024


async def _comprobar_cupo(cola: ColaIndexacion) -> None:
    """Lanza 429 si no cabe un trabajo mas."""
    en_vuelo = await cola.en_vuelo()
    if en_vuelo >= get_settings().index_max_en_vuelo:
        raise HTTPException(
            status_code=429,
            detail="Hay demasiados trabajos en cola o ejecutandose.",
            headers={"Retry-After": str(REINTENTAR_EN)},
        )


async def _encolar_trabajo(
    cola: ColaIndexacion, db: Session, *,
    file_path: str, tipo: str, size: int | None,
) -> dict:
    """Crea la fila en la BD, encola el trabajo, y devuelve la respuesta 202."""
    job_id = str(uuid.uuid4())
    nombre = os.path.basename(file_path)

    try:
        document_crud.crear_documento_encolado(
            db, origen=file_path, nombre=nombre, tipo=tipo,
            tamano=size, job_id=job_id,
        )
    except Exception:
        db.rollback()
        raise DocumentoYaExiste(file_path)

    await cola.encolar(job_id, file_path=file_path, type=tipo, size=size)
    return {"job_id": job_id, "status": "en-cola"}


def _ruta_segura(nombre_cliente: str | None, carpeta: Path) -> Path:
    base = os.path.basename((nombre_cliente or "").replace("\\", "/")).strip()

    if not base or base in (".", ".."):
        raise HTTPException(status_code=400, detail="Nombre de fichero no valido.")

    destino = (carpeta / base).resolve()
    if not destino.is_relative_to(carpeta.resolve()):
        raise HTTPException(status_code=400, detail="Nombre de fichero no valido.")

    return destino


@router.post(
    "/indexar",
    response_model=TrabajoEncoladoOut,
    status_code=202,
    summary="Encolar la indexacion de un fichero local",
    responses=RESPUESTAS_COMUNES,
)
async def indexar(
    body: IndexRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    cola: ColaIndexacion = request.app.state.cola
    await _comprobar_cupo(cola)

    try:
        resultado = await _encolar_trabajo(
            cola, db,
            file_path=body.file_path, tipo=body.type, size=body.size,
        )
    except DocumentoYaExiste as e:
        raise HTTPException(status_code=409, detail=str(e))

    return resultado


@router.post(
    "/indexar-url",
    response_model=TrabajoEncoladoOut,
    status_code=202,
    summary="Encolar la indexacion de una pagina web",
    responses=RESPUESTAS_COMUNES,
)
async def indexar_url(
    body: IndexUrlRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    cola: ColaIndexacion = request.app.state.cola
    await _comprobar_cupo(cola)

    try:
        resultado = await _encolar_trabajo(
            cola, db,
            file_path=body.url, tipo="url", size=body.size,
        )
    except DocumentoYaExiste as e:
        raise HTTPException(status_code=409, detail=str(e))

    return resultado


@router.post(
    "/indexar-fichero",
    response_model=FicheroEncoladoOut,
    status_code=202,
    summary="Subir un fichero y encolar su indexacion",
    responses={
        **RESPUESTAS_COMUNES,
        400: {"model": ErrorOut, "description": "Nombre de fichero no valido o fichero vacio."},
        413: {"model": ErrorOut, "description": "El fichero supera APP_UPLOAD_MAX_BYTES."},
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

    parcial = destino.with_name(destino.name + ".parcial")

    escritos = 0
    try:
        with parcial.open("wb") as salida:
            while trozo := await fichero.read(TROZO_BYTES):
                escritos += len(trozo)
                if escritos > settings.upload_max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"El fichero supera el limite de "
                            f"{settings.upload_max_bytes} bytes."
                        ),
                    )
                salida.write(trozo)

        if escritos == 0:
            raise HTTPException(status_code=400, detail="El fichero esta vacio.")

        os.replace(parcial, destino)
    except HTTPException:
        parcial.unlink(missing_ok=True)
        raise
    except OSError as e:
        parcial.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"No se pudo guardar el fichero: {e}")

    extension = destino.suffix.lstrip(".").lower() or "txt"

    cola: ColaIndexacion = request.app.state.cola

    try:
        await _comprobar_cupo(cola)
    except HTTPException:
        destino.unlink(missing_ok=True)
        raise

    try:
        resultado = await _encolar_trabajo(
            cola, db,
            file_path=str(destino), tipo=extension, size=escritos,
        )
    except DocumentoYaExiste as e:
        raise HTTPException(status_code=409, detail=str(e))

    return {**resultado, "ruta": str(destino)}
