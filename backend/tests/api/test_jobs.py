"""Tests del endpoint GET /trabajos/{job_id}.

Comprueba que el frontend puede consultar el estado de un trabajo encolado.
"""

import uuid

from app.db.crud import document as document_crud


def test_trabajo_existente_devuelve_su_estado(client, db):
    job_id = str(uuid.uuid4())
    document_crud.crear_documento_encolado(
        db, origen="/docs/a.pdf", nombre="a.pdf", tipo="pdf",
        tamano=100, job_id=job_id,
    )
    resp = client.get(f"/trabajos/{job_id}")
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["job_id"] == job_id
    assert cuerpo["status"] == "en-cola"
    assert cuerpo["num_chunks"] == 0
    assert cuerpo["origin"] == "/docs/a.pdf"
    assert cuerpo["name"] == "a.pdf"


def test_trabajo_inexistente_devuelve_404(client):
    resp = client.get(f"/trabajos/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_trabajo_indexado_tiene_chunks(client, db):
    job_id = str(uuid.uuid4())
    doc = document_crud.crear_documento_encolado(
        db, origen="/docs/b.pdf", nombre="b.pdf", tipo="pdf",
        tamano=200, job_id=job_id,
    )
    document_crud.marcar_indexado(db, doc, num_chunks=42)

    resp = client.get(f"/trabajos/{job_id}")
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["status"] == "indexado"
    assert cuerpo["num_chunks"] == 42


def test_trabajo_con_error_tiene_mensaje(client, db):
    job_id = str(uuid.uuid4())
    doc = document_crud.crear_documento_encolado(
        db, origen="/docs/c.pdf", nombre="c.pdf", tipo="pdf",
        tamano=300, job_id=job_id,
    )
    document_crud.marcar_error(db, doc, "Qdrant caido")

    resp = client.get(f"/trabajos/{job_id}")
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["status"] == "error"
    assert cuerpo["error_message"] == "Qdrant caido"
