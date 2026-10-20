"""Endpoints de app/api/routers/indexation.py.

Tras la migracion a cola, los POST devuelven 202 con un job_id en vez de
esperar a que termine la indexacion. La logica de ingesta esta cubierta en
tests/integration/test_indexation_service.py; aqui solo se comprueba la
traduccion a codigos HTTP y que los ficheros quedan en su sitio.
"""
import uuid
from pathlib import Path

from app.core.config import get_settings
from app.db.crud import document as document_crud

CUERPO = {"file_path": "/docs/manual.pdf", "name": "manual.pdf", "type": "pdf", "size": 10}


def test_documento_nuevo_devuelve_202_con_job_id(client):
    respuesta = client.post("/indexar", json=CUERPO)

    assert respuesta.status_code == 202
    cuerpo = respuesta.json()
    assert cuerpo["status"] == "en-cola"
    uuid.UUID(cuerpo["job_id"])


def test_origen_duplicado_devuelve_409(client, db):
    document_crud.crear_documento(db, "/docs/manual.pdf", "manual.pdf", "pdf", 10)

    respuesta = client.post("/indexar", json=CUERPO)

    assert respuesta.status_code == 409
    assert "ya está indexado" in respuesta.json()["detail"]


def test_cuerpo_incompleto_devuelve_422(client):
    respuesta = client.post("/indexar", json={"name": "manual.pdf"})

    assert respuesta.status_code == 422


def test_indexar_url_devuelve_202_con_tipo_url(client, db):
    respuesta = client.post("/indexar-url", json={"url": "https://ejemplo.com/doc", "size": 5})

    assert respuesta.status_code == 202
    cuerpo = respuesta.json()
    uuid.UUID(cuerpo["job_id"])

    doc = document_crud.listar_documentos(db)[0]
    assert doc.type == "url"
    assert doc.origin == "https://ejemplo.com/doc"
    assert doc.state == "en-cola"


def test_cola_llena_devuelve_429(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "index_max_concurrentes", 0)
    monkeypatch.setattr(get_settings(), "index_max_en_cola", 0)

    respuesta = client.post("/indexar", json=CUERPO)

    assert respuesta.status_code == 429
    assert respuesta.headers["retry-after"] == "120"


# ---------------------------------------------------------------------------
# POST /indexar-fichero
# ---------------------------------------------------------------------------

def _subir(client, nombre, contenido):
    return client.post(
        "/indexar-fichero",
        files={"fichero": (nombre, contenido, "application/pdf")},
    )


def test_un_fichero_valido_se_guarda_entero_y_sin_restos(client, carpeta_subidas):
    respuesta = _subir(client, "manual.pdf", b"x" * 5000)

    assert respuesta.status_code == 202
    cuerpo = respuesta.json()
    uuid.UUID(cuerpo["job_id"])
    assert cuerpo["status"] == "en-cola"
    assert "ruta" in cuerpo

    guardado = carpeta_subidas / "manual.pdf"
    assert guardado.read_bytes() == b"x" * 5000
    assert list(carpeta_subidas.glob("*.parcial")) == []


def test_un_fichero_demasiado_grande_no_deja_nada_en_la_ruta_definitiva(
    client, carpeta_subidas, monkeypatch
):
    monkeypatch.setattr(get_settings(), "upload_max_bytes", 1000)

    respuesta = _subir(client, "grande.pdf", b"x" * 5000)

    assert respuesta.status_code == 413
    assert not (carpeta_subidas / "grande.pdf").exists()
    assert list(carpeta_subidas.glob("*.parcial")) == []


def test_un_fichero_vacio_no_deja_restos(client, carpeta_subidas):
    respuesta = _subir(client, "vacio.pdf", b"")

    assert respuesta.status_code == 400
    assert not (carpeta_subidas / "vacio.pdf").exists()
    assert list(carpeta_subidas.glob("*.parcial")) == []


def test_un_nombre_con_ruta_se_queda_en_la_carpeta_de_subidas(client, carpeta_subidas):
    respuesta = _subir(client, "../../fuera.pdf", b"x" * 5000)

    assert respuesta.status_code == 202
    assert (carpeta_subidas / "fuera.pdf").exists()
    assert not (carpeta_subidas.parent / "fuera.pdf").exists()


def test_la_ruta_definitiva_aparece_de_una_vez_y_ya_completa(
    client, carpeta_subidas, monkeypatch
):
    import os as _os

    import app.api.routers.indexation as router

    visto = {}
    real = _os.replace

    def espiar(origen, destino):
        visto["contenido_del_parcial"] = Path(origen).read_bytes()
        visto["la_definitiva_ya_existia"] = Path(destino).exists()
        return real(origen, destino)

    monkeypatch.setattr(router, "TROZO_BYTES", 512)
    monkeypatch.setattr(_os, "replace", espiar)

    respuesta = _subir(client, "entero.pdf", b"y" * 5000)

    assert respuesta.status_code == 202
    assert visto["contenido_del_parcial"] == b"y" * 5000
    assert visto["la_definitiva_ya_existia"] is False


def test_cola_llena_borra_el_fichero_subido(client, carpeta_subidas, monkeypatch):
    """Si la cola esta llena, el fichero que se acaba de subir se borra."""
    monkeypatch.setattr(get_settings(), "index_max_concurrentes", 0)
    monkeypatch.setattr(get_settings(), "index_max_en_cola", 0)

    respuesta = _subir(client, "rechazado.pdf", b"x" * 5000)

    assert respuesta.status_code == 429
    assert not (carpeta_subidas / "rechazado.pdf").exists()
