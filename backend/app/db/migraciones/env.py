"""Entorno de Alembic.

Si quien llama pasa una conexion en `config.attributes["connection"]` (es lo
que hace app.db.migrar), se migra esa. Si no (la CLI), se abre una con la URL
de Settings.
"""
from alembic import context
from sqlalchemy import create_engine

from app.core.config import get_settings
from app.db.models.document import Base
# El modelo de conversaciones registra sus tablas en el mismo Base al importarse.
from app.db.models import conversation as _conversation_models  # noqa: F401

target_metadata = Base.metadata


def _migrar(conexion) -> None:
    context.configure(
        connection=conexion,
        target_metadata=target_metadata,
        # SQLite no sabe alterar columnas: el modo batch recrea la tabla.
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


conexion = context.config.attributes.get("connection")
if conexion is not None:
    _migrar(conexion)
else:
    motor = create_engine(get_settings().db_url)
    with motor.connect() as conexion:
        _migrar(conexion)
    motor.dispose()
