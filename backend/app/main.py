from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Annotated
from app.api.schemas import QueryRequest, IndexRequest, IndexUrlRequest, MensajeOut, ConversacionResumenOut, ConversacionDetalleOut
from app.api.app_state import lifespan
from app.core.config import get_settings
from app.rag.remove import borrar_por_origen
from app.db.sesion import get_db
from app.db import document_crud, record_crud

from app.rag.indexation import indexar_documento
from sqlalchemy.orm import Session

from app.core.excepcions import DocumentoYaExiste, FalloIngesta, ConversacionNoEncontrada

from app.rag.query import responder


app = FastAPI(lifespan=lifespan)

@app.post("/preguntar")
def preguntar(body: QueryRequest, request: Request, db: Annotated[Session, Depends(get_db)],):

    try:
        generador = responder(
            db=db,
            query=body.query,
            conversacion_id=body.conversacion_id,
            dense_embedder=request.app.state.dense_embedder,
            sparse_embedder=request.app.state.sparse_embedder,
            cross_encoder=request.app.state.cross_encoder,
            qdrant=request.app.state.qdrant,
            model=get_settings().llm_model,
        )
    except ConversacionNoEncontrada as e:
        raise HTTPException(status_code=404, detail=str(e))

    return StreamingResponse(generador, media_type="text/event-stream")


@app.post(
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

@app.post(
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
            type= "url"

        )
    except DocumentoYaExiste as e:
        raise HTTPException(status_code=409, detail=str(e))
    except FalloIngesta as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "indexado", **resultado}


@app.get(
    "/documentos",
    responses={500: {"description": "Error interno del servidor."}, 
               404: {"description": "Documentos no encontrados."}}
)
def listar(db: Annotated[Session, Depends(get_db)]):
    try:
        documentos = document_crud.listar_documentos(db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not documentos:
        raise HTTPException(status_code=404, detail="No se encontraron documentos.")

    return {"documentos": documentos}

@app.delete(
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
        if borrar_por_origen(qdrant=request.app.state.qdrant, origen=documento):
            eliminado = document_crud.eliminar_documento(db, documento)
        else:
            return {"status": "fallo en el borrado", "documento": documento}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not eliminado:
        raise HTTPException(status_code=404, detail="Documento no encontrado.")

    return {"status": "eliminado", "documento": documento}

@app.get(
        "/conversaciones", 
        response_model=list[ConversacionResumenOut])

def listar_conversaciones(
    db: Annotated[Session, Depends(get_db)]
):
    return record_crud.listar_conversaciones(db, usuario="local")

@app.delete(
    "/conversaciones/{conversacion_id}",
    responses={404: {"description": "Conversación no encontrada."}},
)
def eliminar_conversacion(
    conversacion_id: int, 
    db: Annotated[Session, Depends(get_db)]
):
    if not record_crud.eliminar_conversacion(db, conversacion_id):
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    return {"status": "eliminada", "id": conversacion_id}

@app.get(
    "/conversaciones/{conversacion_id}",
    response_model=ConversacionDetalleOut,
    responses={404: {"description": "Conversación no encontrada."}},
)
def obtener_conversacion(conversacion_id: int, db: Annotated[Session, Depends(get_db)]):
    conv = record_crud.obtener_conversacion(db, conversacion_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    return conv
