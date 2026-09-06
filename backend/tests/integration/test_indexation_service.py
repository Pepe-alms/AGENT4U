"""Integracion de app/services/indexation_service.py.

Base de datos SQLite en memoria y dobles de Qdrant y docling. Lo que se
comprueba es la orquestacion: que la fila del documento acabe en el estado
correcto y que un fallo a mitad de ingesta no deje basura ni en la base de
datos ni en el vector store.
"""
import pytest

from app.core.exceptions import DocumentoYaExiste, FalloIngesta
from app.db.crud import document as document_crud
from app.rag.vectorization import COLLECTION_NAME
from app.services.indexation_service import indexar_documento


def indexar(db, qdrant, converter, chunker, dense_embedder, sparse_embedder,
            file_path="/docs/manual.pdf", type="pdf", size=1234):
    return indexar_documento(
        db=db,
        file_path=file_path,
        converter=converter,
        chunker=chunker,
        dense_embedder=dense_embedder,
        sparse_embedder=sparse_embedder,
        qdrant=qdrant,
        type=type,
        size=size,
    )


def test_indexa_el_documento_y_lo_marca_como_indexado(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    resultado = indexar(db, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert resultado == {"status": "indexado", "num_chunks": 2}

    doc = document_crud.listar_documentos(db)[0]
    assert doc.state == "indexado"
    assert doc.num_chunks == 2
    assert doc.origin == "/docs/manual.pdf"
    assert doc.name == "manual.pdf"
    assert doc.error_message is None


def test_los_puntos_llegan_a_qdrant_con_su_metadato(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    indexar(db, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert len(qdrant.puntos) == 2
    payloads = [p.payload for p in qdrant.puntos]
    assert {p["nombre"] for p in payloads} == {"manual.pdf"}
    assert {p["origen"] for p in payloads} == {"/docs/manual.pdf"}
    assert {p["tipo"] for p in payloads} == {"pdf"}
    assert payloads[0]["paginas"] == [1, 2]
    assert payloads[1]["paginas"] == [3]


def test_crea_la_coleccion_si_no_existe(
    db, qdrant_sin_coleccion, converter, chunker, dense_embedder, sparse_embedder
):
    indexar(db, qdrant_sin_coleccion, converter, chunker, dense_embedder, sparse_embedder)

    assert qdrant_sin_coleccion.colecciones_creadas == [COLLECTION_NAME]


def test_origen_duplicado_lanza_documento_ya_existe(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    document_crud.crear_documento(db, "/docs/manual.pdf", "manual.pdf", "pdf", 10)

    with pytest.raises(DocumentoYaExiste) as excinfo:
        indexar(db, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert excinfo.value.origen == "/docs/manual.pdf"
    assert len(document_crud.listar_documentos(db)) == 1
    assert qdrant.puntos == []


def test_fallo_a_mitad_de_ingesta_marca_error_y_limpia_los_vectores(
    db, qdrant_que_falla_al_subir, converter, chunker, dense_embedder, sparse_embedder
):
    with pytest.raises(FalloIngesta) as excinfo:
        indexar(db, qdrant_que_falla_al_subir, converter, chunker, dense_embedder, sparse_embedder)

    assert "Qdrant rechazo el upsert" in str(excinfo.value)

    doc = document_crud.listar_documentos(db)[0]
    assert doc.state == "error"
    assert "Qdrant rechazo el upsert" in doc.error_message
    assert qdrant_que_falla_al_subir.borrados == [COLLECTION_NAME]


def test_tras_un_error_el_mismo_origen_sigue_bloqueado(
    db, qdrant_que_falla_al_subir, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    with pytest.raises(FalloIngesta):
        indexar(db, qdrant_que_falla_al_subir, converter, chunker, dense_embedder, sparse_embedder)

    with pytest.raises(DocumentoYaExiste):
        indexar(db, qdrant, converter, chunker, dense_embedder, sparse_embedder)
