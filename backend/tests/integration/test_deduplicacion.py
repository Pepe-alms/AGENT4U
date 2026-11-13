"""Deduplicacion de documentos al indexar (app/services/indexacion.py).

Nivel 2: mismo contenido en otro envoltorio. El nivel 1 (mismos bytes) se
prueba en la capa HTTP, porque se rechaza antes de encolar
(tests/api/test_indexation.py).
"""
from types import SimpleNamespace

import pytest

from app.db.crud import document as document_crud
from app.services import contenidos
from app.services.huellas import hash_texto_normalizado, normalizar_texto
from app.services.indexacion import indexar_documento

from tests.conftest import FakeDocumento


class DocumentoConTexto(FakeDocumento):
    """Un documento cuyo texto extraido es el que se le diga."""

    def __init__(self, origen: str, texto: str):
        super().__init__(origen)
        self.texto = texto

    def export_to_text(self) -> str:
        return self.texto


class ConverterConTextos:
    """Cada ruta da el texto que se le asigna: dos ficheros distintos (un PDF y
    un DOCX) pueden dar el mismo contenido."""

    def __init__(self, textos: dict[str, str]):
        self.textos = textos

    def convert(self, file_path: str):
        return SimpleNamespace(document=DocumentoConTexto(file_path, self.textos[file_path]))


def crear(db, origen):
    return document_crud.crear_documento(db, origen, origen.rsplit("/", 1)[1], "pdf", 1).id


def indexar(doc_id, origen, converter, chunker, dense_embedder, sparse_embedder, qdrant, **extra):
    return indexar_documento(
        doc_id, file_path=origen, converter=converter, chunker=chunker,
        dense_embedder=dense_embedder, sparse_embedder=sparse_embedder, qdrant=qdrant, **extra,
    )


@pytest.fixture
def mismo_texto_en_dos_formatos():
    return ConverterConTextos({
        "/docs/contrato.pdf": "Contrato de servicios.\n\nCláusula primera: el precio.",
        # El mismo texto, como lo daria otro formato: otros saltos, otros
        # espacios, otra caja.
        "/docs/contrato.docx": "CONTRATO DE SERVICIOS.   Cláusula  primera:\tel precio.",
        "/docs/otro.pdf": "Contrato de servicios.\n\nCláusula primera: otro precio.",
    })


# ---------------------------------------------------------------------------
# Normalizacion
# ---------------------------------------------------------------------------

def test_la_normalizacion_ignora_espacios_saltos_mayusculas_y_ligaduras():
    assert normalizar_texto("  Uno\n\ndos\tTRES  ") == "uno dos tres"
    # "ﬁ" es una ligadura que algunos PDF sacan como un solo caracter.
    assert normalizar_texto("ﬁnal") == normalizar_texto("FINAL")


def test_un_texto_distinto_da_otra_huella():
    a = hash_texto_normalizado(DocumentoConTexto("a", "El precio es 100 euros."))
    b = hash_texto_normalizado(DocumentoConTexto("b", "El precio es 200 euros."))
    assert a != b


# ---------------------------------------------------------------------------
# Nivel 2 al indexar
# ---------------------------------------------------------------------------

def test_el_mismo_contenido_en_otro_formato_queda_duplicado_sin_indexarse(
    db, qdrant, mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder,
    documentos_frescos,
):
    pdf = crear(db, "/docs/contrato.pdf")
    docx = crear(db, "/docs/contrato.docx")
    indexar(pdf, "/docs/contrato.pdf", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)
    puntos_del_original = len(qdrant.puntos)

    resultado = indexar(docx, "/docs/contrato.docx", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)

    assert resultado == 0
    filas = {d.id: d for d in documentos_frescos()}
    assert filas[docx].state == "duplicado"
    assert filas[docx].duplicado_de == pdf
    assert filas[docx].hash_texto_normalizado == filas[pdf].hash_texto_normalizado
    # Ni puntos en Qdrant ni contenido guardado.
    assert len(qdrant.puntos) == puntos_del_original
    assert contenidos.leer_markdown(docx) is None
    assert not contenidos.ruta_json(docx).exists()


def test_un_contenido_distinto_se_indexa_normal(
    db, qdrant, mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder,
    documentos_frescos,
):
    pdf = crear(db, "/docs/contrato.pdf")
    otro = crear(db, "/docs/otro.pdf")
    indexar(pdf, "/docs/contrato.pdf", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)

    indexar(otro, "/docs/otro.pdf", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)

    assert {d.id: d.state for d in documentos_frescos()}[otro] == "indexado"


def test_un_original_en_error_no_cuenta(
    db, qdrant, mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder,
    documentos_frescos,
):
    """Un documento en error no tiene nada en Qdrant: no es un original."""
    pdf = crear(db, "/docs/contrato.pdf")
    docx = crear(db, "/docs/contrato.docx")
    qdrant.fallar_upsert = True
    with pytest.raises(RuntimeError):
        indexar(pdf, "/docs/contrato.pdf", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)
    qdrant.fallar_upsert = False

    indexar(docx, "/docs/contrato.docx", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)

    assert {d.id: d.state for d in documentos_frescos()} == {pdf: "error", docx: "indexado"}


def test_sin_comprobar_duplicados_se_indexa_aunque_coincida(
    db, qdrant, mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder,
    documentos_frescos,
):
    pdf = crear(db, "/docs/contrato.pdf")
    docx = crear(db, "/docs/contrato.docx")
    indexar(pdf, "/docs/contrato.pdf", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)

    indexar(docx, "/docs/contrato.docx", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant,
            comprobar_duplicados=False)

    assert {d.id: d.state for d in documentos_frescos()}[docx] == "indexado"
