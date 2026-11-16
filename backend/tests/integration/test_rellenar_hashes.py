"""scripts/rellenar_hashes.py contra una base SQLite en tmp_path, nunca la del
proyecto. Los ficheros de origen tambien estan en tmp_path, y la carpeta de
contenidos la desvia a tmp_path el fixture autouse de conftest."""
import hashlib

import pytest
from sqlalchemy import create_engine, text

import scripts.rellenar_hashes as rellenar
from app.db.migrar import migrar
from app.services import contenidos
from app.services.huellas import hash_texto_normalizado

from tests.integration.test_contenidos import documento_docling


@pytest.fixture
def base(tmp_path):
    """Una base al dia con tres documentos sin huellas: dos con el mismo
    fichero y uno cuyo fichero ya no existe."""
    motor = create_engine(f"sqlite:///{tmp_path / 'agent4u.db'}")
    migrar(motor)
    a = tmp_path / "a.pdf"
    b = tmp_path / "b.pdf"
    a.write_bytes(b"mismo fichero")
    b.write_bytes(b"mismo fichero")
    with motor.begin() as c:
        for id_, origen in ((1, a), (2, b), (3, tmp_path / "borrado.pdf")):
            c.execute(text(
                "INSERT INTO documents (id, origin, name, type, user, created_at, state, num_chunks) "
                "VALUES (:id, :o, :n, 'pdf', 'local', '2026-01-01', 'indexado', 1)"
            ), {"id": id_, "o": str(origen), "n": origen.name})
    yield motor
    motor.dispose()


def huellas(motor) -> dict[int, tuple]:
    with motor.connect() as c:
        return {f.id: (f.hash_content, f.hash_texto_normalizado)
                for f in c.execute(text("SELECT id, hash_content, hash_texto_normalizado FROM documents"))}


def test_el_ensayo_no_escribe_nada_pero_enseña_los_duplicados(base, capsys):
    assert rellenar.main([], motor=base) == 0

    assert huellas(base) == {1: (None, None), 2: (None, None), 3: (None, None)}
    salida = capsys.readouterr().out
    assert "no se ha escrito nada" in salida
    assert "[1] a.pdf (indexado) = [2] b.pdf (indexado)" in salida
    assert "[3] borrado.pdf (indexado): su fichero ya no existe, sin contenido guardado" in salida


def test_aplicar_rellena_el_hash_del_fichero_y_el_del_contenido_guardado(base, capsys):
    documento = documento_docling(2)
    contenidos.confirmar(2, contenidos.guardar_temporales(2, documento))

    assert rellenar.main(["--aplicar"], motor=base) == 0

    hechas = huellas(base)
    esperado = hashlib.sha256(b"mismo fichero").hexdigest()
    assert hechas[1] == (esperado, None)  # sin contenido guardado: sin huella de texto
    assert hechas[2] == (esperado, hash_texto_normalizado(documento))
    assert hechas[3] == (None, None)  # su fichero ya no existe
    # Los duplicados se enseñan, no se tocan.
    assert "[1] a.pdf (indexado) = [2] b.pdf (indexado)" in capsys.readouterr().out
    with base.connect() as c:
        assert c.execute(text("SELECT count(*) FROM documents WHERE state = 'indexado'")).scalar() == 3
