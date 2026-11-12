"""Deja la base de datos al dia al arrancar, sin pasos manuales.

Lo llaman la API (lifespan) y el worker (startup). Cubre tres casos:

1. Base vacia: `alembic upgrade head` la crea entera.
2. Base con `alembic_version`: `upgrade head` aplica lo que falte.
3. Base creada antes de Alembic, con `create_all`: se reparan las tablas,
   columnas e indices que falten, comparando con los modelos, y se marca en
   `head`. Antes se hace una copia del fichero. Nunca se borra ni se modifica
   nada que ya exista: lo que sobre o sea distinto se deja como esta.

`create_all`, que es lo que habia antes, no añade columnas a tablas que ya
existen: una base antigua se quedaba sin `documents.job_id` y la app fallaba
al primer uso.

La API y el worker arrancan a la vez sobre el mismo fichero: la migracion va
bajo un `flock` para que el segundo espere y encuentre el trabajo hecho.
"""

import contextlib
import datetime
import fcntl
import logging
import sqlite3
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Column, inspect, text
from sqlalchemy.engine import Connection, Engine

from app.db.models.document import Base
# El modelo de conversaciones registra sus tablas en el mismo Base al importarse.
from app.db.models import conversation as _conversation_models  # noqa: F401

logger = logging.getLogger(__name__)

CARPETA_MIGRACIONES = Path(__file__).resolve().parent / "migraciones"


def migrar(motor: Engine | None = None) -> None:
    """Lleva la base de `motor` (por defecto, la de Settings) a `head`."""
    if motor is None:
        from app.db.session import engine as motor

    with _cerrojo(motor):
        with motor.begin() as conexion:
            tablas = set(inspect(conexion).get_table_names())
            nuestras = set(Base.metadata.tables)
            if "alembic_version" not in tablas and tablas & nuestras:
                _copia_de_seguridad(motor)
                _reparar(conexion)
                command.stamp(_config(conexion), "head")
            command.upgrade(_config(conexion), "head")

        if motor.dialect.name == "sqlite":
            with motor.connect() as conexion:
                conexion.execute(text("PRAGMA journal_mode=WAL"))
                conexion.commit()


def _config(conexion: Connection) -> Config:
    config = Config()
    config.set_main_option("script_location", str(CARPETA_MIGRACIONES))
    config.attributes["connection"] = conexion
    return config


def _reparar(conexion: Connection) -> None:
    """Añade lo que falte a una base creada sin Alembic. Solo añade."""
    diferencias = compare_metadata(MigrationContext.configure(conexion), Base.metadata)
    op = Operations(MigrationContext.configure(conexion))

    for diferencia in diferencias:
        # Las de columnas llegan agrupadas en listas; el resto, sueltas.
        tipo = diferencia[0] if isinstance(diferencia, tuple) else None
        if tipo == "add_table":
            diferencia[1].create(conexion, checkfirst=True)
            logger.warning("Migracion: creada la tabla %s", diferencia[1].name)
        elif tipo == "add_column":
            _, _, tabla, columna = diferencia
            op.add_column(tabla, _columna_con_defecto(tabla, columna))
            logger.warning("Migracion: añadida la columna %s.%s", tabla, columna.name)
        elif tipo == "add_index":
            # checkfirst: crear una tabla o una columna indexada ya puede
            # haberlo creado.
            diferencia[1].create(conexion, checkfirst=True)
            logger.warning("Migracion: creado el indice %s", diferencia[1].name)
        else:
            # Columnas o indices de mas, tipos distintos...: se dejan.
            logger.info("Migracion: se deja sin tocar %s", diferencia)


def _columna_con_defecto(tabla: str, columna: Column) -> Column:
    """La columna tal cual, o con un valor por defecto si es NOT NULL.

    SQLite no deja añadir una columna NOT NULL sin valor por defecto. Se usa
    el del modelo cuando es un valor simple; si es una funcion (la fecha de
    ahora, un id aleatorio), no hay un valor honrado para las filas que ya
    existen, y se para en vez de inventarlo.
    """
    # Una columna nueva, sin indice ni unicidad: los indices los crea su
    # propia diferencia `add_index`.
    if columna.nullable or columna.server_default is not None:
        defecto_servidor = columna.server_default.arg if columna.server_default is not None else None
        return Column(columna.name, columna.type, nullable=columna.nullable,
                      server_default=defecto_servidor)

    defecto = columna.default.arg if columna.default is not None else None
    if defecto is None or callable(defecto):
        raise RuntimeError(
            f"La base no tiene la columna obligatoria {tabla}.{columna.name} y "
            "no hay un valor por defecto simple con el que rellenar las filas "
            "que ya existen. Añadela a mano o restaura una base completa."
        )
    literal = repr(defecto) if isinstance(defecto, str) else str(defecto)
    return Column(columna.name, columna.type, nullable=False, server_default=text(literal))


def _ruta_sqlite(motor: Engine) -> Path | None:
    """El fichero de la base, o None si no es SQLite en disco."""
    if motor.dialect.name != "sqlite":
        return None
    base = motor.url.database
    if not base or base == ":memory:" or base.startswith("file:"):
        return None
    return Path(base).resolve()


@contextlib.contextmanager
def _cerrojo(motor: Engine):
    ruta = _ruta_sqlite(motor)
    if ruta is None:
        yield
        return
    with open(ruta.with_name(ruta.name + ".migracion.lock"), "w") as fichero:
        fcntl.flock(fichero, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fichero, fcntl.LOCK_UN)


def _copia_de_seguridad(motor: Engine) -> None:
    """Copia la base antes de tocarla por primera vez con Alembic.

    Con la API de backup de sqlite3 y no copiando el fichero: con WAL, parte
    de los datos puede estar aun en el -wal y una copia a pelo los perderia.
    """
    ruta = _ruta_sqlite(motor)
    if ruta is None or not ruta.exists():
        return
    marca = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    destino = ruta.with_name(f"{ruta.name}.antes-de-alembic-{marca}")
    origen, copia = sqlite3.connect(ruta), sqlite3.connect(destino)
    try:
        origen.backup(copia)
    finally:
        copia.close()
        origen.close()
    logger.warning("Migracion: copia de seguridad en %s", destino)
