"""Endpoints de app/api/routers/documents.py."""
from app.db.crud import document as document_crud


def test_sin_documentos_devuelve_404(client):
    respuesta = client.get("/documentos")

    assert respuesta.status_code == 404


def test_con_documentos_devuelve_200_y_la_lista(client, db):
    document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 10)

    respuesta = client.get("/documentos")

    assert respuesta.status_code == 200
    assert respuesta.json()["documentos"][0]["name"] == "a.pdf"


def test_eliminar_documento_inexistente_devuelve_404(client):
    respuesta = client.delete("/documentos/no-existe.pdf")

    assert respuesta.status_code == 404


def test_eliminar_documento_existente_devuelve_200(client, db):
    document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 10)

    respuesta = client.delete("/documentos/a.pdf")

    assert respuesta.status_code == 200
    assert respuesta.json() == {"status": "eliminado", "documento": "a.pdf"}


def test_si_falla_qdrant_responde_200_avisando_del_fallo(client, db, qdrant):
    document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 10)
    qdrant.fallar_delete = True

    respuesta = client.delete("/documentos/a.pdf")

    assert respuesta.status_code == 200
    assert respuesta.json()["status"] == "fallo en el borrado"
