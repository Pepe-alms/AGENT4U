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


def test_un_trabajo_duplicado_dice_cual_es_el_original(client, db):
    original = document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 1)
    document_crud.marcar_indexado(db, original, 3)
    doc = document_crud.crear_documento_encolado(
        db, origen="/docs/a.docx", nombre="a.docx", tipo="docx", tamano=1, job_id="j-dup",
    )
    document_crud.marcar_duplicado(db, doc, original.id)

    cuerpo = client.get("/trabajos/j-dup").json()

    assert cuerpo["status"] == "duplicado"
    assert cuerpo["documento_id"] == doc.id
    assert cuerpo["relacionado"] == {"id": original.id, "name": "a.pdf", "state": "indexado"}


def test_un_trabajo_pendiente_trae_el_parecido_y_los_porcentajes(client, db):
    antiguo = document_crud.crear_documento(db, "/docs/v1.pdf", "v1.pdf", "pdf", 1)
    doc = document_crud.crear_documento_encolado(
        db, origen="/docs/v2.pdf", nombre="v2.pdf", tipo="pdf", tamano=1, job_id="j-pend",
    )
    document_crud.marcar_pendiente_decision(db, doc, antiguo.id, 0.75, 0.9)

    cuerpo = client.get("/trabajos/j-pend").json()

    assert cuerpo["relacionado"]["name"] == "v1.pdf"
    assert (cuerpo["pct_nuevo_en_antiguo"], cuerpo["pct_antiguo_en_nuevo"]) == (0.75, 0.9)


def test_un_trabajo_normal_no_trae_relacionado(client, db):
    doc = document_crud.crear_documento_encolado(
        db, origen="/docs/b.pdf", nombre="b.pdf", tipo="pdf", tamano=1, job_id="j-normal",
    )

    cuerpo = client.get("/trabajos/j-normal").json()

    assert cuerpo["documento_id"] == doc.id
    assert cuerpo["relacionado"] is None
