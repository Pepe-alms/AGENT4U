"""Endpoints de app/api/routers/indexation.py.

Solo se comprueba la traduccion a codigos HTTP; la logica de ingesta esta
cubierta en tests/integration/test_indexation_service.py.
"""
from app.db.crud import document as document_crud

CUERPO = {"file_path": "/docs/manual.pdf", "name": "manual.pdf", "type": "pdf", "size": 10}


def test_documento_nuevo_devuelve_200(client):
    respuesta = client.post("/indexar", json=CUERPO)

    assert respuesta.status_code == 200
    assert respuesta.json() == {"status": "indexado", "num_chunks": 2}


def test_origen_duplicado_devuelve_409(client, db):
    document_crud.crear_documento(db, "/docs/manual.pdf", "manual.pdf", "pdf", 10)

    respuesta = client.post("/indexar", json=CUERPO)

    assert respuesta.status_code == 409
    assert "ya está indexado" in respuesta.json()["detail"]


def test_fallo_de_ingesta_devuelve_500(client, qdrant):
    qdrant.fallar_upsert = True

    respuesta = client.post("/indexar", json={**CUERPO, "file_path": "/docs/roto.pdf"})

    assert respuesta.status_code == 500
    assert "Fallo al ingerir" in respuesta.json()["detail"]


def test_cuerpo_incompleto_devuelve_422(client):
    respuesta = client.post("/indexar", json={"name": "manual.pdf"})

    assert respuesta.status_code == 422


def test_indexar_url_reutiliza_el_flujo_con_tipo_url(client, db):
    respuesta = client.post("/indexar-url", json={"url": "https://ejemplo.com/doc", "size": 5})

    assert respuesta.status_code == 200
    doc = document_crud.listar_documentos(db)[0]
    assert doc.type == "url"
    assert doc.origin == "https://ejemplo.com/doc"
