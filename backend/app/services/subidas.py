"""Los ficheros que la aplicacion guarda en la carpeta de subidas.

Solo se borran los que estan DENTRO de `Settings.upload_dir`: los que se
indexan con POST /indexar por ruta son ficheros del usuario, donde quiera que
esten, y nunca se tocan.
"""

import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models.document import Document

logger = logging.getLogger(__name__)


def _dentro_de_subidas(ruta: Path) -> bool:
    """Si la ruta, ya resuelta, cae dentro de la carpeta de subidas.

    Se resuelve antes de comparar: un enlace simbolico dentro de uploads/ que
    apunte fuera resuelve fuera, y no se borra lo que hay al otro lado.
    """
    carpeta = Path(get_settings().upload_dir).resolve()
    return ruta != carpeta and ruta.is_relative_to(carpeta)


def borrar_fichero_subido(db: Session, origen: str, salvo: int | None = None) -> bool:
    """Borra el fichero de `origen` si es una subida que ya no usa nadie.

    `salvo` es el documento que lo dejo de usar (el que se borra o el que se
    ha movido a otra ruta). Devuelve True si borro algo. Si la carpeta de la
    huella (uploads/<hash16>/) se queda vacia, tambien se va.
    """
    ruta = Path(origen).resolve()
    if not _dentro_de_subidas(ruta) or not ruta.is_file():
        return False

    # Otro documento podria apuntar al mismo fichero con otra forma de la
    # ruta ("./uploads/x" y "uploads/x"): se comparan las rutas resueltas.
    otros = db.scalars(select(Document.origin).where(Document.id != salvo) if salvo is not None
                       else select(Document.origin))
    if any(Path(o).resolve() == ruta for o in otros):
        return False

    try:
        ruta.unlink()
    except OSError as e:
        logger.warning("No se pudo borrar el fichero subido %s: %s", ruta, e)
        return False

    carpeta_huella = ruta.parent
    if _dentro_de_subidas(carpeta_huella) and not any(carpeta_huella.iterdir()):
        carpeta_huella.rmdir()
    return True
