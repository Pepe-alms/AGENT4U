"""Los temporales de subida (`.subiendo-*.parcial`) no se quedan huerfanos.

La carpeta de subidas la desvia a tmp_path el fixture autouse de conftest.
"""
import asyncio
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

import app.api.routers.indexation as router
from app.core.config import get_settings
from app.services.cola_port import ColaEnMemoria
from app.services.subidas import limpiar_parciales


@pytest.fixture
def subidas() -> Path:
    carpeta = Path(get_settings().upload_dir)
    carpeta.mkdir(parents=True, exist_ok=True)
    return carpeta


class SubidaQueSeCancela:
    """Un UploadFile que entrega un trozo y luego ve cancelada su tarea, como
    cuando el servidor se reinicia a mitad de una subida."""

    filename = "grande.pdf"

    def __init__(self):
        self.lecturas = 0

    async def read(self, _tamano: int) -> bytes:
        self.lecturas += 1
        if self.lecturas == 1:
            return b"x" * 1024
        raise asyncio.CancelledError()


class Subida:
    filename = "bien.pdf"

    def __init__(self, contenido: bytes):
        self._trozos = [contenido, b""]

    async def read(self, _tamano: int) -> bytes:
        return self._trozos.pop(0)


def parciales(carpeta: Path) -> list[Path]:
    return list(carpeta.rglob("*.parcial"))


async def test_una_subida_cancelada_a_mitad_no_deja_temporal(subidas):
    with pytest.raises(asyncio.CancelledError):
        await router._recibir_en_parcial(SubidaQueSeCancela(), subidas, 10_000)

    assert parciales(subidas) == []


async def test_una_cancelacion_despues_de_recibirla_tampoco(subidas, db, monkeypatch):
    """Entre recibir el fichero y moverlo a su sitio hay esperas (el cupo de
    la cola): si la peticion se cancela ahi, el temporal tambien se va."""
    async def cancelada(_cola):
        raise asyncio.CancelledError()

    monkeypatch.setattr(router, "_comprobar_cupo", cancelada)
    peticion = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(cola=ColaEnMemoria())))

    with pytest.raises(asyncio.CancelledError):
        await router.indexar_fichero(request=peticion, db=db, fichero=Subida(b"contenido"))

    assert parciales(subidas) == []
    assert [p for p in subidas.rglob("*") if p.is_file()] == []


async def test_una_subida_correcta_no_deja_temporal_y_si_su_fichero(subidas, db):
    peticion = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(cola=ColaEnMemoria())))

    resultado = await router.indexar_fichero(request=peticion, db=db, fichero=Subida(b"contenido"))

    assert parciales(subidas) == []
    assert Path(resultado["ruta"]).read_bytes() == b"contenido"


def test_al_arrancar_se_borran_solo_los_temporales_de_subida(subidas, tmp_path):
    huerfanos = [subidas / ".subiendo-aaaa.parcial", subidas / ".subiendo-bbbb.parcial"]
    for ruta in huerfanos:
        ruta.write_bytes(b"a medias")
    # Lo que no se toca: un fichero normal, un .parcial con otro nombre y lo
    # que hay dentro de las carpetas de huella.
    normal = subidas / "manual.pdf"
    otro_parcial = subidas / "manual.pdf.parcial"
    dentro = subidas / "0123456789abcdef" / ".subiendo-cccc.parcial"
    dentro.parent.mkdir()
    for ruta in (normal, otro_parcial, dentro):
        ruta.write_bytes(b"no tocar")
    # Un enlace con nombre de temporal: se borra el enlace, no su destino.
    destino = tmp_path / "fuera.pdf"
    destino.write_bytes(b"mio")
    enlace = subidas / ".subiendo-dddd.parcial"
    os.symlink(destino, enlace)

    assert limpiar_parciales() == 3

    assert not any(r.exists() for r in huerfanos)
    assert not enlace.is_symlink()
    assert destino.read_bytes() == b"mio"
    assert all(r.read_bytes() == b"no tocar" for r in (normal, otro_parcial, dentro))


def test_sin_carpeta_de_subidas_no_hace_nada():
    assert limpiar_parciales() == 0
