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


def test_un_nombre_repetido_responde_409_y_no_borra_ninguno(client, db):
    document_crud.crear_documento(db, "/docs/x/a.pdf", "a.pdf", "pdf", 10)
    document_crud.crear_documento(db, "/docs/y/a.pdf", "a.pdf", "pdf", 10)

    respuesta = client.delete("/documentos/a.pdf")

    assert respuesta.status_code == 409
    assert len(document_crud.listar_documentos(db)) == 2


# ---------------------------------------------------------------------------
# GET /documentos/{id}/contenido
# ---------------------------------------------------------------------------

def test_contenido_devuelve_el_markdown_y_los_datos_del_documento(client, db):
    from app.services import contenidos

    doc = document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 10)
    contenidos.ruta_markdown(doc.id).write_text(
        "<!-- pagina 1 -->\n\n# Uno\n\n<!-- pagina 2 -->\n\nDos", encoding="utf-8"
    )

    respuesta = client.get(f"/documentos/{doc.id}/contenido")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["documento"]["id"] == doc.id
    assert cuerpo["documento"]["name"] == "a.pdf"
    assert cuerpo["markdown"].endswith("Dos")
    assert cuerpo["paginas"] == 2


def test_contenido_de_un_documento_inexistente_responde_404(client):
    respuesta = client.get("/documentos/9999/contenido")

    assert respuesta.status_code == 404
    assert "9999" in respuesta.json()["detail"]


def test_contenido_de_un_documento_indexado_antes_del_cambio_responde_409(client, db):
    """Existe, pero no tiene contenido: no es lo mismo que no existir."""
    doc = document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 10)
    document_crud.marcar_indexado(db, doc, 3)

    respuesta = client.get(f"/documentos/{doc.id}/contenido")

    assert respuesta.status_code == 409
    assert "generar_contenido.py" in respuesta.json()["detail"]


def test_contenido_de_un_documento_en_cola_explica_el_motivo(client, db):
    doc = document_crud.crear_documento_encolado(
        db, origen="/docs/a.pdf", nombre="a.pdf", tipo="pdf", tamano=10, job_id="j1",
    )

    respuesta = client.get(f"/documentos/{doc.id}/contenido")

    assert respuesta.status_code == 409
    assert "en cola" in respuesta.json()["detail"]
