import os
import uuid
from pathlib import Path

import hashlib

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from typing import Annotated
from sqlalchemy.orm import Session

from app.api.schemas import (
    ErrorMismoFicheroOut,
    ErrorOut,
    FicheroEncoladoOut,
    IndexRequest,
    IndexUrlRequest,
    TrabajoEncoladoOut,
)
from app.core.config import get_settings
from app.core.exceptions import DocumentoYaExiste
from app.db.crud import document as document_crud
from app.db.models.document import Document
from app.db.session import get_db
from app.services.cola_port import ColaIndexacion
from app.services.huellas import hash_fichero
from app.services.subidas import borrar_fichero_subido

router = APIRouter(tags=["indexacion"])

REINTENTAR_EN = 120

RESPUESTAS_COMUNES = {
    409: {"model": ErrorOut, "description": "Documento ya existe."},
}

RESPUESTAS_FICHERO = {
    409: {
        "model": ErrorMismoFicheroOut,
        "description": (
            "Ya hay un documento con esa ruta, o con exactamente el mismo "
            "fichero (mismo SHA-256, se llame como se llame). En el segundo "
            "caso 'motivo' es 'mismo-fichero' y 'duplicado_de' dice cual. Si "
            "el unico documento con ese fichero esta en error, no se rechaza: "
            "se reintenta sobre ese mismo documento (202)."
        ),
    },
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


def _mismo_fichero(db: Session, huella: str) -> tuple[JSONResponse | None, Document | None]:
    """El nivel 1 al recibir un fichero.

    Devuelve (409, None) si ya hay un documento con esos mismos bytes, y
    (None, documento) si el unico que los tiene esta en error: entonces no se
    rechaza, se reintenta sobre ese mismo documento. (None, None) si es nuevo.
    """
    original = document_crud.por_hash_content(db, huella)
    if original is None:
        return None, None
    if original.state == "error":
        return None, original
    cuerpo = ErrorMismoFicheroOut(
        detail=(
            f"Es exactamente el mismo fichero que '{original.name}' "
            f"(id {original.id}, {original.state}). No se ha indexado."
        ),
        duplicado_de={"id": original.id, "name": original.name, "state": original.state},
    )
    return JSONResponse(status_code=409, content=cuerpo.model_dump()), None


async def _reintentar_trabajo(
    cola: ColaIndexacion, db: Session, doc: Document, *,
    file_path: str, size: int | None, hash_content: str,
) -> dict:
    """Vuelve a indexar un documento que acabo en error con este mismo fichero."""
    job_id = str(uuid.uuid4())
    origen_anterior = doc.origin
    try:
        document_crud.reintentar(
            db, doc, origen=file_path, nombre=os.path.basename(file_path),
            job_id=job_id, hash_content=hash_content,
        )
    except Exception:
        db.rollback()
        raise DocumentoYaExiste(file_path)
    # Si ahora apunta a otro fichero, el anterior se queda sin dueño: se
    # borra si es una subida (los de POST /indexar por ruta no se tocan).
    if origen_anterior != file_path:
        borrar_fichero_subido(db, origen_anterior)
    await cola.encolar(job_id, file_path=file_path, type=doc.type, size=size)
    return {"job_id": job_id, "status": "en-cola"}


async def _encolar_trabajo(
    cola: ColaIndexacion, db: Session, *,
    file_path: str, tipo: str, size: int | None, hash_content: str | None = None,
) -> dict:
    """Crea la fila en la BD, encola el trabajo, y devuelve la respuesta 202."""
    job_id = str(uuid.uuid4())
    nombre = os.path.basename(file_path)

    try:
        document_crud.crear_documento_encolado(
            db, origen=file_path, nombre=nombre, tipo=tipo,
            tamano=size, job_id=job_id, hash_content=hash_content,
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
    responses={
        **RESPUESTAS_COMUNES,
        **RESPUESTAS_FICHERO,
        400: {"model": ErrorOut, "description": "El fichero no existe o no se puede leer."},
    },
)
async def indexar(
    body: IndexRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    cola: ColaIndexacion = request.app.state.cola
    await _comprobar_cupo(cola)

    # El hash se calcula aqui, antes de encolar: un fichero repetido se
    # rechaza sin ocupar la cola ni gastar minutos de Docling.
    try:
        huella = await run_in_threadpool(hash_fichero, body.file_path)
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"No se puede leer '{body.file_path}': {e.strerror or e}")
    rechazo, en_error = _mismo_fichero(db, huella)
    if rechazo is not None:
        return rechazo

    try:
        if en_error is not None:
            resultado = await _reintentar_trabajo(
                cola, db, en_error, file_path=body.file_path, size=body.size, hash_content=huella,
            )
        else:
            resultado = await _encolar_trabajo(
                cola, db,
                file_path=body.file_path, tipo=body.type, size=body.size,
                hash_content=huella,
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
        **RESPUESTAS_FICHERO,
        400: {"model": ErrorOut, "description": "Nombre de fichero no valido o fichero vacio."},
        413: {"model": ErrorOut, "description": "El fichero supera APP_UPLOAD_MAX_BYTES."},
    },
)
async def indexar_fichero(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    fichero: Annotated[UploadFile, File(description="Fichero a indexar.")],
):
    """Guarda el fichero en `uploads/<huella>/<nombre>` y lo encola.

    La carpeta sale de los primeros 16 caracteres del SHA-256: dos ficheros
    distintos con el mismo nombre no chocan, y nunca se pisa el fichero de
    otro documento. Antes se escribia en `uploads/<nombre>` ANTES de
    comprobar nada, y subir otro `manual.pdf` sobrescribia el del documento
    que ya existia aunque la peticion acabara en 409.
    """
    settings = get_settings()
    carpeta = Path(settings.upload_dir)
    carpeta.mkdir(parents=True, exist_ok=True)

    # Solo para validar el nombre: la ruta definitiva depende del contenido.
    nombre = _ruta_segura(fichero.filename, carpeta).name

    # Se escribe en un temporal mientras se calcula el hash, en la misma
    # carpeta para que el rename final sea atomico.
    parcial = carpeta / f".subiendo-{uuid.uuid4().hex}.parcial"
    huella = hashlib.sha256()
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
                huella.update(trozo)
                salida.write(trozo)

        if escritos == 0:
            raise HTTPException(status_code=400, detail="El fichero esta vacio.")
    except HTTPException:
        parcial.unlink(missing_ok=True)
        raise
    except OSError as e:
        parcial.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"No se pudo guardar el fichero: {e}")

    hash_content = huella.hexdigest()
    rechazo, en_error = _mismo_fichero(db, hash_content)
    if rechazo is not None:
        parcial.unlink(missing_ok=True)
        return rechazo

    cola: ColaIndexacion = request.app.state.cola
    try:
        await _comprobar_cupo(cola)
    except HTTPException:
        parcial.unlink(missing_ok=True)
        raise

    destino = carpeta / hash_content[:16] / nombre
    try:
        destino.parent.mkdir(exist_ok=True)
        os.replace(parcial, destino)
    except OSError as e:
        parcial.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"No se pudo guardar el fichero: {e}")

    extension = destino.suffix.lstrip(".").lower() or "txt"

    try:
        if en_error is not None:
            resultado = await _reintentar_trabajo(
                cola, db, en_error, file_path=str(destino), size=escritos, hash_content=hash_content,
            )
        else:
            resultado = await _encolar_trabajo(
                cola, db,
                file_path=str(destino), tipo=extension, size=escritos,
                hash_content=hash_content,
            )
    except DocumentoYaExiste as e:
        raise HTTPException(status_code=409, detail=str(e))

    return {**resultado, "ruta": str(destino)}
