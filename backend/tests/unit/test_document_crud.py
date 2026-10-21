"""Tests de las funciones CRUD nuevas para la cola de trabajos.

Usan la misma BD en memoria que el resto de tests (engine + session del
conftest raiz).
"""

import uuid

from app.db.crud import document as document_crud


def test_crear_documento_encolado_tiene_estado_en_cola(db):
    job_id = str(uuid.uuid4())
    doc = document_crud.crear_documento_encolado(
        db, origen="/docs/a.pdf", nombre="a.pdf", tipo="pdf",
        tamano=100, job_id=job_id,
    )
    assert doc.state == "en-cola"
    assert doc.job_id == job_id
    assert doc.num_chunks == 0
    assert doc.error_message is None


def test_obtener_por_job_id_devuelve_el_documento(db):
    job_id = str(uuid.uuid4())
    document_crud.crear_documento_encolado(
        db, origen="/docs/b.pdf", nombre="b.pdf", tipo="pdf",
        tamano=200, job_id=job_id,
    )
    doc = document_crud.obtener_por_job_id(db, job_id)
    assert doc is not None
    assert doc.origin == "/docs/b.pdf"
    assert doc.job_id == job_id


def test_obtener_por_job_id_devuelve_none_si_no_existe(db):
    assert document_crud.obtener_por_job_id(db, "inexistente") is None


def test_marcar_indexando_cambia_el_estado(db):
    job_id = str(uuid.uuid4())
    doc = document_crud.crear_documento_encolado(
        db, origen="/docs/c.pdf", nombre="c.pdf", tipo="pdf",
        tamano=300, job_id=job_id,
    )
    document_crud.marcar_indexando(db, doc)
    assert doc.state == "indexando"


def test_contar_en_vuelo_solo_cuenta_en_cola_e_indexando(db):
    j1 = str(uuid.uuid4())
    j2 = str(uuid.uuid4())
    j3 = str(uuid.uuid4())

    document_crud.crear_documento_encolado(
        db, origen="/d1.pdf", nombre="d1.pdf", tipo="pdf", tamano=1, job_id=j1,
    )
    doc2 = document_crud.crear_documento_encolado(
        db, origen="/d2.pdf", nombre="d2.pdf", tipo="pdf", tamano=2, job_id=j2,
    )
    doc3 = document_crud.crear_documento_encolado(
        db, origen="/d3.pdf", nombre="d3.pdf", tipo="pdf", tamano=3, job_id=j3,
    )

    # doc1 sigue en-cola, doc2 indexando, doc3 ya terminado
    document_crud.marcar_indexando(db, doc2)
    document_crud.marcar_indexado(db, doc3, num_chunks=5)

    assert document_crud.contar_en_vuelo(db) == 2
