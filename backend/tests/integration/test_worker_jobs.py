"""Tests de la funcion que ejecuta el worker de ARQ.

`indexar_job` recibe un job_id, busca el documento en la BD, lo indexa y
actualiza el estado. Aqui se prueba con los mismos dobles que el resto de
tests de integracion: base de datos en memoria, FakeQdrant, FakeConverter, etc.
"""
import uuid

import pytest

from app.db.crud import document as document_crud
from app.worker.jobs import indexar_job


def _ctx(converter, chunker, dense_embedder, sparse_embedder, qdrant):
    """Simula el `ctx` que ARQ pasa al job con los modelos cargados."""
    return {
        "converter": converter,
        "chunker": chunker,
        "dense_embedder": dense_embedder,
        "sparse_embedder": sparse_embedder,
        "qdrant": qdrant,
    }


@pytest.fixture
def job_id():
    return str(uuid.uuid4())


@pytest.fixture
def doc_encolado(db, job_id):
    return document_crud.crear_documento_encolado(
        db, origen="/docs/manual.pdf", nombre="manual.pdf",
        tipo="pdf", tamano=100, job_id=job_id,
    )


async def test_job_exitoso_marca_indexado(
    db, doc_encolado, job_id, documentos_frescos,
    converter, chunker, dense_embedder, sparse_embedder, qdrant,
):
    ctx = _ctx(converter, chunker, dense_embedder, sparse_embedder, qdrant)

    await indexar_job(ctx, job_id, "/docs/manual.pdf", "pdf", 100)

    doc = documentos_frescos()[0]
    assert doc.state == "indexado"
    assert doc.num_chunks == 2


async def test_job_fallido_marca_error(
    db, doc_encolado, job_id, documentos_frescos,
    converter, chunker, dense_embedder, sparse_embedder, qdrant,
):
    qdrant.fallar_upsert = True
    ctx = _ctx(converter, chunker, dense_embedder, sparse_embedder, qdrant)

    with pytest.raises(Exception):
        await indexar_job(ctx, job_id, "/docs/manual.pdf", "pdf", 100)

    doc = documentos_frescos()[0]
    assert doc.state == "error"
    assert doc.error_message is not None


async def test_job_limpia_vectores_antes_de_empezar(
    db, doc_encolado, job_id,
    converter, chunker, dense_embedder, sparse_embedder, qdrant,
):
    """Idempotencia: borrar_por_origen se llama ANTES de vectorizar."""
    ctx = _ctx(converter, chunker, dense_embedder, sparse_embedder, qdrant)

    await indexar_job(ctx, job_id, "/docs/manual.pdf", "pdf", 100)

    assert len(qdrant.borrados) > 0
    assert len(qdrant.puntos) > 0


async def test_job_con_documento_borrado_sale_limpio(
    db, doc_encolado, job_id,
    converter, chunker, dense_embedder, sparse_embedder, qdrant,
):
    """Si el usuario borro el documento mientras estaba en cola, el job no revienta."""
    document_crud.eliminar_documento(db, "manual.pdf")

    ctx = _ctx(converter, chunker, dense_embedder, sparse_embedder, qdrant)
    await indexar_job(ctx, job_id, "/docs/manual.pdf", "pdf", 100)

    assert qdrant.puntos == []
