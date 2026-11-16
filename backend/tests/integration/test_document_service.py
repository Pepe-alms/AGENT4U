"""Integracion de app/services/document_service.py.

El borrado toca dos sistemas (Qdrant y la base de datos) y el orden importa:
primero los vectores, y solo si eso sale bien la fila. Estos tests fijan esa
invariante, que es la que evita quedarse con vectores huerfanos.
"""
from app.db.crud import document as document_crud
from app.rag.vectorization import COLLECTION_NAME
from app.services import document_service


def crear_doc(db, origen="/docs/manual.pdf", nombre="manual.pdf"):
    return document_crud.crear_documento(db, origen, nombre, "pdf", 100)


def test_listar_devuelve_los_documentos_mas_recientes_primero(db, qdrant):
    crear_doc(db, "/docs/a.pdf", "a.pdf")
    crear_doc(db, "/docs/b.pdf", "b.pdf")

    documentos = document_service.listar_documentos(db)

    assert {d.name for d in documentos} == {"a.pdf", "b.pdf"}


def test_elimina_el_documento_y_sus_vectores(db, qdrant):
    doc = crear_doc(db)

    resultado = document_service.eliminar_documento(db, qdrant=qdrant, documento_id=doc.id)

    assert resultado.name == "manual.pdf"
    assert document_service.listar_documentos(db) == []
    assert qdrant.borrados == [COLLECTION_NAME]


def test_un_documento_inexistente_devuelve_false(db, qdrant):
    resultado = document_service.eliminar_documento(db, qdrant=qdrant, documento_id=9999)

    assert resultado is False


def test_si_falla_el_borrado_de_vectores_no_se_toca_la_base_de_datos(db, qdrant_que_falla_al_borrar):
    doc = crear_doc(db)

    resultado = document_service.eliminar_documento(
        db, qdrant=qdrant_que_falla_al_borrar, documento_id=doc.id
    )

    assert resultado is None
    assert [d.name for d in document_service.listar_documentos(db)] == ["manual.pdf"]


def test_si_la_coleccion_no_existe_tampoco_se_borra_la_fila(db, qdrant_sin_coleccion):
    doc = crear_doc(db)

    resultado = document_service.eliminar_documento(
        db, qdrant=qdrant_sin_coleccion, documento_id=doc.id
    )

    assert resultado is None
    assert len(document_service.listar_documentos(db)) == 1


def test_el_borrado_filtra_por_documento_id(db, qdrant):
    doc = crear_doc(db)

    document_service.eliminar_documento(db, qdrant=qdrant, documento_id=doc.id)

    condiciones = qdrant.filtros_borrado[0].filter.must
    assert [(c.key, c.match.value) for c in condiciones] == [("documento_id", doc.id)]


def test_con_dos_documentos_del_mismo_nombre_se_borra_solo_el_pedido(db, qdrant):
    """El borrado por nombre era ambiguo; por id no."""
    a = crear_doc(db, "/docs/a/manual.pdf", "manual.pdf")
    b = crear_doc(db, "/docs/b/manual.pdf", "manual.pdf")

    document_service.eliminar_documento(db, qdrant=qdrant, documento_id=b.id)

    assert [d.id for d in document_service.listar_documentos(db)] == [a.id]
