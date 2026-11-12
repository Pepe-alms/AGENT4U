"""Integracion de app/services/indexacion.py, el unico camino de indexacion.

La identidad de los puntos (un documento no pisa ni borra los fragmentos de
otro) se prueba contra Qdrant en memoria y no contra FakeQdrant: el doble no
sobrescribe por id ni aplica filtros, que es justo lo que hay que medir. El
resto usa FakeQdrant, que cuenta lotes y puede fallar a voluntad.
"""
import hashlib

import pytest
from qdrant_client import QdrantClient, models

from app.core.config import get_settings
from app.db.crud import document as document_crud
from app.db.models.document import Document
from app.rag.vectorization import COLLECTION_NAME, borrar_por_documento, id_punto
from app.services.indexacion import indexar_documento

from tests.conftest import FakeChunker, hacer_chunk, texto_largo

# Qdrant en memoria acepta los indices de payload pero avisa de que no los usa.
pytestmark = pytest.mark.filterwarnings("ignore:Payload indexes have no effect")


@pytest.fixture
def qdrant_real(monkeypatch):
    """Qdrant de verdad, en memoria. Los embedders falsos dan vectores de 4."""
    monkeypatch.setattr(get_settings(), "dimension_densa", 4)
    cliente = QdrantClient(":memory:")
    yield cliente
    cliente.close()


def crear_doc(db, origen="/docs/manual.pdf", nombre="manual.pdf"):
    return document_crud.crear_documento(db, origen, nombre, "pdf", 100).id


def indexar(doc_id, qdrant, converter, chunker, dense_embedder, sparse_embedder,
            origen="/docs/manual.pdf"):
    return indexar_documento(
        doc_id, file_path=origen, converter=converter, chunker=chunker,
        dense_embedder=dense_embedder, sparse_embedder=sparse_embedder,
        qdrant=qdrant,
    )


def puntos_de(qdrant, doc_id) -> list:
    puntos, _ = qdrant.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=models.Filter(must=[
            models.FieldCondition(key="documento_id", match=models.MatchValue(value=doc_id)),
        ]),
        limit=100,
        with_payload=True,
    )
    return puntos


def total(qdrant) -> int:
    return qdrant.count(collection_name=COLLECTION_NAME).count


# ---------------------------------------------------------------------------
# Identidad de documento
# ---------------------------------------------------------------------------

def test_dos_documentos_con_un_fragmento_identico_conservan_cada_uno_su_punto(
    db, qdrant_real, converter, chunker, dense_embedder, sparse_embedder
):
    """Con el id sobre el texto, el segundo documento pisaba al primero."""
    a = crear_doc(db, "/docs/a.pdf", "a.pdf")
    b = crear_doc(db, "/docs/b.pdf", "b.pdf")

    # El mismo chunker: los dos documentos tienen exactamente el mismo texto.
    indexar(a, qdrant_real, converter, chunker, dense_embedder, sparse_embedder, "/docs/a.pdf")
    indexar(b, qdrant_real, converter, chunker, dense_embedder, sparse_embedder, "/docs/b.pdf")

    assert len(puntos_de(qdrant_real, a)) == 2
    assert len(puntos_de(qdrant_real, b)) == 2
    assert total(qdrant_real) == 4


def test_borrar_un_documento_no_borra_otro_con_el_mismo_nombre(
    db, qdrant_real, converter, chunker, dense_embedder, sparse_embedder
):
    """Antes se borraba por nombre: dos manual.pdf en rutas distintas caian juntos."""
    a = crear_doc(db, "/docs/a/manual.pdf", "manual.pdf")
    b = crear_doc(db, "/docs/b/manual.pdf", "manual.pdf")
    indexar(a, qdrant_real, converter, chunker, dense_embedder, sparse_embedder, "/docs/a/manual.pdf")
    indexar(b, qdrant_real, converter, chunker, dense_embedder, sparse_embedder, "/docs/b/manual.pdf")

    assert borrar_por_documento(qdrant_real, a) is True

    assert puntos_de(qdrant_real, a) == []
    assert len(puntos_de(qdrant_real, b)) == 2


def test_reindexar_el_mismo_documento_no_cambia_el_numero_de_puntos(
    db, qdrant_real, converter, chunker, dense_embedder, sparse_embedder
):
    doc = crear_doc(db)

    indexar(doc, qdrant_real, converter, chunker, dense_embedder, sparse_embedder)
    antes = total(qdrant_real)
    indexar(doc, qdrant_real, converter, chunker, dense_embedder, sparse_embedder)

    assert antes == 2
    assert total(qdrant_real) == antes


def test_reindexar_con_menos_fragmentos_no_deja_puntos_sobrantes(
    db, qdrant_real, converter, chunker, dense_embedder, sparse_embedder
):
    """El upsert sobrescribe por (documento, orden), pero si el documento
    encoge, los ordenes del final sobrarian: por eso se borra antes."""
    doc = crear_doc(db)
    indexar(doc, qdrant_real, converter, chunker, dense_embedder, sparse_embedder)

    uno_solo = FakeChunker([hacer_chunk(texto_largo("Solo queda este."))])
    indexar(doc, qdrant_real, converter, uno_solo, dense_embedder, sparse_embedder)

    assert total(qdrant_real) == 1


def test_el_payload_lleva_documento_orden_y_hash_y_el_id_sale_de_ellos(
    db, qdrant_real, converter, chunker, dense_embedder, sparse_embedder
):
    doc = crear_doc(db)

    indexar(doc, qdrant_real, converter, chunker, dense_embedder, sparse_embedder)

    puntos = sorted(puntos_de(qdrant_real, doc), key=lambda p: p.payload["orden"])
    # La cabecera del chunker de prueba se descarta: los ordenes no tienen huecos.
    assert [p.payload["orden"] for p in puntos] == [0, 1]
    for p in puntos:
        assert p.payload["documento_id"] == doc
        assert p.payload["hash_texto"] == hashlib.sha256(
            p.payload["texto_crudo"].encode("utf-8")
        ).hexdigest()
        assert str(p.id) == id_punto(doc, p.payload["orden"])
        # Lo que ya habia sigue ahi.
        assert p.payload["nombre"] == "manual.pdf"
        assert p.payload["origen"] == "/docs/manual.pdf"


# ---------------------------------------------------------------------------
# Estado del documento y fallos (con FakeQdrant)
# ---------------------------------------------------------------------------

def test_indexa_y_marca_como_indexado(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder, documentos_frescos
):
    doc = crear_doc(db)

    assert indexar(doc, qdrant, converter, chunker, dense_embedder, sparse_embedder) == 2

    fila = documentos_frescos()[0]
    assert fila.state == "indexado"
    assert fila.num_chunks == 2


def test_crea_la_coleccion_con_sus_indices_de_payload(
    db, qdrant_sin_coleccion, converter, chunker, dense_embedder, sparse_embedder
):
    doc = crear_doc(db)

    indexar(doc, qdrant_sin_coleccion, converter, chunker, dense_embedder, sparse_embedder)

    assert qdrant_sin_coleccion.colecciones_creadas == [COLLECTION_NAME]
    assert qdrant_sin_coleccion.indices_payload == ["documento_id", "hash_texto"]


def test_un_fallo_a_mitad_marca_error_limpia_y_relanza(
    db, qdrant_que_falla_al_subir, converter, chunker, dense_embedder, sparse_embedder,
    documentos_frescos
):
    doc = crear_doc(db)

    with pytest.raises(RuntimeError):
        indexar(doc, qdrant_que_falla_al_subir, converter, chunker, dense_embedder, sparse_embedder)

    fila = documentos_frescos()[0]
    assert fila.state == "error"
    assert "upsert" in fila.error_message
    # Un borrado antes de empezar y otro para limpiar tras el fallo.
    filtros = qdrant_que_falla_al_subir.filtros_borrado
    assert len(filtros) == 2
    assert all(f.filter.must[0].match.value == doc for f in filtros)


def test_si_la_fila_ya_no_existe_no_hace_nada(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    doc = crear_doc(db)
    document_crud.eliminar_documento(db, db.get(Document, doc))

    assert indexar(doc, qdrant, converter, chunker, dense_embedder, sparse_embedder) is None
    assert qdrant.puntos == []


def test_un_documento_mas_grande_que_el_lote_se_sube_en_varias_tandas(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder, monkeypatch
):
    """En memoria solo hay `index_lote_upsert` puntos, sea el documento de
    diez paginas o de mil."""
    monkeypatch.setattr(get_settings(), "index_lote_upsert", 1)
    doc = crear_doc(db)

    indexar(doc, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert qdrant.lotes == [1, 1]
    assert len(qdrant.puntos) == 2


class EmbedderEspia:
    def __init__(self, interno):
        self._interno = interno
        self.llamadas = 0

    def embed(self, textos):
        self.llamadas += 1
        return self._interno.embed(textos)


def test_si_qdrant_no_responde_no_se_vectoriza_nada(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder, documentos_frescos
):
    """La coleccion se comprueba antes de vectorizar: si Qdrant esta caido,
    mejor saberlo en el primer segundo que tras minutos de CPU."""
    def caido(collection_name):
        raise RuntimeError("Qdrant no responde")

    qdrant.collection_exists = caido
    espia = EmbedderEspia(dense_embedder)
    doc = crear_doc(db)

    with pytest.raises(RuntimeError):
        indexar(doc, qdrant, converter, chunker, espia, sparse_embedder)

    assert espia.llamadas == 0
    assert qdrant.puntos == []
    assert documentos_frescos()[0].state == "error"
