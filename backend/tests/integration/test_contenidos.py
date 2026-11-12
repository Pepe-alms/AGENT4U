"""El contenido completo que se guarda al indexar (app/services/contenidos.py).

La carpeta de contenidos la redirige a tmp_path el fixture autouse de
conftest: ningun test escribe en backend/contenidos.
"""
import pytest
from docling_core.types.doc import DocItemLabel, DoclingDocument, ProvenanceItem, Size
from docling_core.types.doc.base import BoundingBox

from app.db.crud import document as document_crud
from app.services import contenidos, document_service
from app.services.indexacion import indexar_documento

from tests.conftest import FakeDocumento


def crear_doc(db, origen="/docs/manual.pdf", nombre="manual.pdf"):
    return document_crud.crear_documento(db, origen, nombre, "pdf", 100).id


def indexar(doc_id, qdrant, converter, chunker, dense_embedder, sparse_embedder, **extra):
    return indexar_documento(
        doc_id, file_path="/docs/manual.pdf", converter=converter, chunker=chunker,
        dense_embedder=dense_embedder, sparse_embedder=sparse_embedder, qdrant=qdrant,
        **extra,
    )


def ficheros(doc_id) -> set[str]:
    carpeta = contenidos.ruta_markdown(doc_id).parent
    return {p.name for p in carpeta.glob(f"{doc_id}.*")}


def documento_docling(paginas: int) -> DoclingDocument:
    """Un DoclingDocument de verdad, con un titulo y un parrafo por pagina."""
    doc = DoclingDocument(name="prueba")
    for n in range(1, paginas + 1):
        doc.add_page(page_no=n, size=Size(width=100, height=100))
        caja = ProvenanceItem(page_no=n, bbox=BoundingBox(l=0, t=0, r=10, b=10), charspan=(0, 5))
        doc.add_heading(text=f"Seccion {n}", prov=caja)
        doc.add_text(label=DocItemLabel.TEXT, text=f"Texto de la pagina {n}.", prov=caja)
    return doc


# ---------------------------------------------------------------------------
# Al indexar
# ---------------------------------------------------------------------------

def test_indexar_guarda_el_markdown_con_sus_paginas_y_el_json(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    doc = crear_doc(db)

    indexar(doc, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert ficheros(doc) == {f"{doc}.md", f"{doc}.json"}
    markdown = contenidos.leer_markdown(doc)
    assert markdown.startswith("<!-- pagina 1 -->")
    assert "<!-- pagina 2 -->" in markdown
    assert "Texto de /docs/manual.pdf, pagina 2." in markdown


def test_si_la_indexacion_falla_no_quedan_ficheros(
    db, qdrant_que_falla_al_subir, converter, chunker, dense_embedder, sparse_embedder
):
    doc = crear_doc(db)

    with pytest.raises(RuntimeError):
        indexar(doc, qdrant_que_falla_al_subir, converter, chunker, dense_embedder, sparse_embedder)

    assert ficheros(doc) == set()


def test_un_reindexado_fallido_borra_tambien_el_contenido_anterior(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    """Un documento en error no tiene nada en Qdrant: si conservara su
    contenido viejo, lo que se lee ya no seria lo que usa el RAG."""
    doc = crear_doc(db)
    indexar(doc, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    qdrant.fallar_upsert = True
    with pytest.raises(RuntimeError):
        indexar(doc, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert ficheros(doc) == set()


def test_desde_json_reutiliza_el_documento_guardado_sin_convertir(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder, monkeypatch
):
    doc = crear_doc(db)
    monkeypatch.setattr(contenidos, "cargar_documento", lambda _id: FakeDocumento("guardado"))

    indexar(doc, qdrant, converter, chunker, dense_embedder, sparse_embedder, desde_json=True)

    assert converter.convertidos == []
    assert "Texto de guardado" in contenidos.leer_markdown(doc)


def test_desde_json_sin_json_guardado_convierte_el_fichero(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    doc = crear_doc(db)

    indexar(doc, qdrant, converter, chunker, dense_embedder, sparse_embedder, desde_json=True)

    assert converter.convertidos == ["/docs/manual.pdf"]


def test_borrar_el_documento_borra_su_contenido(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    doc = crear_doc(db)
    indexar(doc, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert document_service.eliminar_documento(db, qdrant=qdrant, nombre="manual.pdf") is True

    assert ficheros(doc) == set()


def test_si_qdrant_no_puede_borrar_el_contenido_se_conserva(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    """La fila se queda, y con ella el contenido: siguen siendo un documento."""
    doc = crear_doc(db)
    indexar(doc, qdrant, converter, chunker, dense_embedder, sparse_embedder)
    qdrant.fallar_delete = True

    assert document_service.eliminar_documento(db, qdrant=qdrant, nombre="manual.pdf") is None

    assert ficheros(doc) == {f"{doc}.md", f"{doc}.json"}


# ---------------------------------------------------------------------------
# Con Docling de verdad
# ---------------------------------------------------------------------------

def test_markdown_con_paginas_numera_cada_pagina_de_un_doclingdocument_real():
    markdown = contenidos.markdown_con_paginas(documento_docling(3))

    assert [int(n) for n in contenidos.PATRON_PAGINA.findall(markdown)] == [1, 2, 3]
    assert contenidos.contar_paginas(markdown) == 3
    # Cada marca va justo antes del contenido de su pagina.
    assert markdown.index("<!-- pagina 2 -->") < markdown.index("Seccion 2") < markdown.index("<!-- pagina 3 -->")
    assert contenidos.SALTO not in markdown


def test_si_las_paginas_no_cuadran_se_guarda_sin_marcas():
    """Un salto que no se puede atribuir a una pagina: mejor sin marcas que
    con una equivocada."""
    class Descuadrado(FakeDocumento):
        def iterate_items(self):
            yield from list(super().iterate_items())[:1]

    markdown = contenidos.markdown_con_paginas(Descuadrado("x", paginas=3))

    assert contenidos.PATRON_PAGINA.findall(markdown) == []
    assert "pagina 3." in markdown


def test_el_json_guardado_se_vuelve_a_cargar_como_doclingdocument(db):
    doc = crear_doc(db)
    original = documento_docling(2)

    contenidos.confirmar(doc, contenidos.guardar_temporales(doc, original))
    cargado = contenidos.cargar_documento(doc)

    assert isinstance(cargado, DoclingDocument)
    assert cargado.export_to_markdown() == original.export_to_markdown()


def test_sin_json_guardado_cargar_devuelve_none():
    assert contenidos.cargar_documento(9999) is None
    assert contenidos.leer_markdown(9999) is None
