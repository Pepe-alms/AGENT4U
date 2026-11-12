"""app/db/migrar.py en los tres casos que tiene que cubrir al arrancar.

Cada test usa su propio fichero SQLite en tmp_path: hace falta un fichero (y
no memoria) para probar la copia de seguridad y el cerrojo, y nunca es el
agent4u.db del proyecto.
"""
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from app.db.migrar import migrar
from app.db.models.document import Base

# Las tablas de documents tal como quedaron en una base creada con create_all
# antes de existir job_id, y despues con job_id añadido a mano sin su indice
# (asi esta, de hecho, una de las bases reales del proyecto).
DOCUMENTS_SIN_JOB_ID = """
CREATE TABLE documents (
    id INTEGER NOT NULL PRIMARY KEY,
    origin VARCHAR(1024) NOT NULL,
    name VARCHAR(512) NOT NULL,
    type VARCHAR(32) NOT NULL,
    size INTEGER,
    hash_content VARCHAR(64),
    user VARCHAR(128) NOT NULL,
    created_at DATETIME NOT NULL,
    state VARCHAR(32) NOT NULL,
    num_chunks INTEGER NOT NULL,
    error_message TEXT
)
"""
UNA_FILA = (
    "INSERT INTO documents (id, origin, name, type, user, created_at, state, num_chunks) "
    "VALUES (1, '/docs/a.pdf', 'a.pdf', 'pdf', 'local', '2026-01-01 00:00:00', 'indexado', 3)"
)


@pytest.fixture
def motor(tmp_path):
    m = create_engine(f"sqlite:///{tmp_path / 'agent4u.db'}")
    yield m
    m.dispose()


def version(motor) -> str | None:
    with motor.connect() as c:
        return c.execute(text("SELECT version_num FROM alembic_version")).scalar()


def diferencias_que_faltan(motor) -> list:
    """Lo que la base no tiene y los modelos si. Tiene que quedar vacio."""
    with motor.connect() as c:
        diferencias = compare_metadata(MigrationContext.configure(c), Base.metadata)
    return [d for d in diferencias if isinstance(d, tuple) and d[0].startswith("add_")]


def copias(tmp_path) -> list:
    return sorted(tmp_path.glob("agent4u.db.antes-de-alembic-*"))


def test_base_vacia_se_crea_entera(motor, tmp_path):
    migrar(motor)

    assert version(motor) == "0001"
    assert diferencias_que_faltan(motor) == []
    # No habia nada que salvar.
    assert copias(tmp_path) == []


def test_base_con_el_esquema_actual_sin_alembic_se_marca_y_conserva_los_datos(motor, tmp_path):
    Base.metadata.create_all(motor)
    with motor.begin() as c:
        c.execute(text(UNA_FILA.replace("num_chunks)", "num_chunks, job_id)").replace("3)", "3, 'j1')")))

    migrar(motor)

    assert version(motor) == "0001"
    assert diferencias_que_faltan(motor) == []
    with motor.connect() as c:
        assert c.execute(text("SELECT name, job_id FROM documents")).all() == [("a.pdf", "j1")]
    assert len(copias(tmp_path)) == 1


def test_base_a_la_que_le_faltan_columnas_e_indices_se_repara(motor, tmp_path):
    with motor.begin() as c:
        c.execute(text(DOCUMENTS_SIN_JOB_ID))
        c.execute(text(UNA_FILA))

    migrar(motor)

    columnas = {col["name"] for col in inspect(motor).get_columns("documents")}
    indices = {i["name"] for i in inspect(motor).get_indexes("documents")}
    assert "job_id" in columnas
    assert {"ix_documents_job_id", "ix_documents_origin"} <= indices
    # Las tablas que no existian, tambien.
    assert {"conversaciones", "mensajes"} <= set(inspect(motor).get_table_names())
    assert diferencias_que_faltan(motor) == []
    with motor.connect() as c:
        assert c.execute(text("SELECT name, state FROM documents")).all() == [("a.pdf", "indexado")]
    # La copia guarda la base tal como estaba, sin job_id.
    copia = create_engine(f"sqlite:///{copias(tmp_path)[0]}")
    assert "job_id" not in {col["name"] for col in inspect(copia).get_columns("documents")}
    copia.dispose()


def test_una_columna_obligatoria_que_falta_se_rellena_con_el_defecto_del_modelo(motor):
    with motor.begin() as c:
        c.execute(text(DOCUMENTS_SIN_JOB_ID.replace("num_chunks INTEGER NOT NULL,", "")))
        c.execute(text(UNA_FILA.replace(", num_chunks)", ")").replace(", 3)", ")")))

    migrar(motor)

    with motor.connect() as c:
        assert c.execute(text("SELECT num_chunks FROM documents")).scalar() == 0


def test_una_columna_obligatoria_sin_defecto_simple_para_el_arranque(motor):
    """created_at se rellena con la hora de ahora: no hay valor honrado para
    las filas viejas, asi que no se inventa."""
    with motor.begin() as c:
        c.execute(text(DOCUMENTS_SIN_JOB_ID.replace("created_at DATETIME NOT NULL,", "")))
        c.execute(text(UNA_FILA.replace(" created_at,", "").replace(" '2026-01-01 00:00:00',", "")))

    with pytest.raises(RuntimeError, match="documents.created_at"):
        migrar(motor)


def test_migrar_dos_veces_no_hace_nada_la_segunda(motor, tmp_path):
    with motor.begin() as c:
        c.execute(text(DOCUMENTS_SIN_JOB_ID))

    migrar(motor)
    migrar(motor)

    assert version(motor) == "0001"
    # La copia es solo para la primera vez que se toca una base sin Alembic.
    assert len(copias(tmp_path)) == 1


def test_la_base_queda_en_modo_wal(motor):
    migrar(motor)

    with motor.connect() as c:
        assert c.execute(text("PRAGMA journal_mode")).scalar() == "wal"


def test_migrar_sin_motor_en_los_tests_no_toca_la_base_del_proyecto(engine):
    """La API y el worker llaman a migrar() sin argumentos. En la suite, el
    fixture autouse lo redirige a la base en memoria."""
    migrar()

    assert "alembic_version" in inspect(engine).get_table_names()
