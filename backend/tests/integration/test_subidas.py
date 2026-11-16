"""Borrar o descartar un documento borra su fichero subido, y solo ese.

La carpeta de subidas la desvia a tmp_path el fixture autouse de conftest.
"""
import os
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.db.crud import document as document_crud
from app.services import document_service
from app.services.cola_port import ColaEnMemoria


@pytest.fixture
def subidas() -> Path:
    carpeta = Path(get_settings().upload_dir)
    carpeta.mkdir(parents=True, exist_ok=True)
    return carpeta


def subido(subidas: Path, huella: str, nombre: str, contenido: bytes = b"pdf") -> Path:
    ruta = subidas / huella / nombre
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_bytes(contenido)
    return ruta


def crear(db, ruta: Path | str, nombre: str = "a.pdf"):
    return document_crud.crear_documento(db, str(ruta), nombre, "pdf", 1)


def test_borrar_un_documento_borra_su_fichero_subido_y_su_carpeta(db, qdrant, subidas):
    ruta = subido(subidas, "aaaaaaaaaaaaaaaa", "a.pdf")
    doc = crear(db, ruta)

    document_service.eliminar_documento(db, qdrant, doc.id)

    assert not ruta.exists()
    assert not ruta.parent.exists()
    assert subidas.exists()


def test_nunca_borra_un_fichero_de_fuera_de_la_carpeta_de_subidas(db, qdrant, tmp_path):
    """Los de POST /indexar por ruta son ficheros del usuario."""
    suyo = tmp_path / "mis-documentos" / "contrato.pdf"
    suyo.parent.mkdir()
    suyo.write_bytes(b"mio")
    doc = crear(db, suyo, "contrato.pdf")

    document_service.eliminar_documento(db, qdrant, doc.id)

    assert suyo.read_bytes() == b"mio"


def test_un_enlace_dentro_de_subidas_que_apunta_fuera_no_borra_lo_de_fuera(db, qdrant, subidas, tmp_path):
    suyo = tmp_path / "fuera.pdf"
    suyo.write_bytes(b"mio")
    enlace = subidas / "bbbbbbbbbbbbbbbb" / "fuera.pdf"
    enlace.parent.mkdir()
    os.symlink(suyo, enlace)
    doc = crear(db, enlace, "fuera.pdf")

    document_service.eliminar_documento(db, qdrant, doc.id)

    assert suyo.read_bytes() == b"mio"


def test_no_se_borra_si_otro_documento_usa_el_mismo_fichero(db, qdrant, subidas):
    ruta = subido(subidas, "cccccccccccccccc", "a.pdf")
    doc = crear(db, ruta)
    # El mismo fichero, escrito de otra forma.
    otro = crear(db, f"{ruta.parent}/./a.pdf", "a.pdf")

    document_service.eliminar_documento(db, qdrant, doc.id)

    assert ruta.exists()
    assert [d.id for d in document_crud.listar_documentos(db)] == [otro.id]


def test_si_qdrant_no_puede_borrar_el_fichero_se_queda(db, qdrant_que_falla_al_borrar, subidas):
    ruta = subido(subidas, "dddddddddddddddd", "a.pdf")
    doc = crear(db, ruta)

    assert document_service.eliminar_documento(db, qdrant_que_falla_al_borrar, doc.id) is None

    assert ruta.exists()


async def test_descartar_un_pendiente_borra_su_fichero_subido(db, qdrant, subidas):
    antiguo = crear(db, subido(subidas, "eeeeeeeeeeeeeeee", "v1.pdf"), "v1.pdf")
    document_crud.marcar_indexado(db, antiguo, 3)
    ruta_nueva = subido(subidas, "ffffffffffffffff", "v2.pdf")
    nuevo = crear(db, ruta_nueva, "v2.pdf")
    document_crud.marcar_pendiente_decision(db, nuevo, antiguo.id, 0.9, 0.9)

    await document_service.resolver_pendiente(db, qdrant, ColaEnMemoria(), nuevo.id, "descartar")

    assert not ruta_nueva.exists()
    assert Path(antiguo.origin).exists()
