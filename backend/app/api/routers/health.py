from fastapi import APIRouter, Request

from app.api.schemas import SaludOut, SaludQdrantOut
from app.core.config import get_settings

router = APIRouter(tags=["salud"])


@router.get(
    "/health",
    response_model=SaludOut,
    summary="Comprobar que el backend responde",
    description="Sonda de vida. No toca Qdrant ni la base de datos: solo "
                "confirma que el proceso acepta peticiones.",
)
def salud():
    return {"status": "ok"}


@router.get(
    "/health/qdrant",
    response_model=SaludQdrantOut,
    summary="Comprobar la conexion con Qdrant",
    description="Pregunta a Qdrant si existe la coleccion configurada. "
                "Responde **200 aunque Qdrant este caido**: hay que mirar el "
                "campo 'status', no el codigo HTTP. Un fallo de Qdrant no es un "
                "fallo de este endpoint, y asi el cliente distingue "
                "'backend caido' de 'backend vivo con Qdrant caido'.",
)
def salud_qdrant(request: Request):
    coleccion = get_settings().qdrant_collection

    try:
        existe = request.app.state.qdrant.collection_exists(coleccion)
    except Exception as e:
        return {
            "status": "error",
            "coleccion": coleccion,
            "existe": False,
            "detalle": str(e),
        }

    return {"status": "ok", "coleccion": coleccion, "existe": existe}
