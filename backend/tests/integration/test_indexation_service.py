"""Integracion de app/services/indexation_service.py.

Base de datos SQLite en memoria y dobles de Qdrant y docling. Lo que se
comprueba es la orquestacion: que la fila del documento acabe en el estado
correcto y que un fallo a mitad de ingesta no deje basura ni en la base de
datos ni en el vector store.
"""
from types import SimpleNamespace

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
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder, documentos_frescos
):
    resultado = indexar(db, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert resultado == {"status": "indexado", "num_chunks": 2}

    doc = documentos_frescos()[0]
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
    db, qdrant_que_falla_al_subir, converter, chunker, dense_embedder,
    sparse_embedder, documentos_frescos
):
    with pytest.raises(FalloIngesta) as excinfo:
        indexar(db, qdrant_que_falla_al_subir, converter, chunker, dense_embedder, sparse_embedder)

    assert "Qdrant rechazo el upsert" in str(excinfo.value)

    doc = documentos_frescos()[0]
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


# ---------------------------------------------------------------------------
# Memoria: los puntos se suben por lotes, no todos de golpe
# ---------------------------------------------------------------------------

def test_por_defecto_los_dos_puntos_caben_en_un_solo_lote(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder
):
    indexar(db, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert qdrant.lotes == [2]


def test_un_documento_mas_grande_que_el_lote_se_sube_en_varias_tandas(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder, monkeypatch
):
    """El techo de memoria deja de depender del tamaño del documento.

    Antes se hacia `np.array(list(embedder.embed(...)))` y un unico `upsert`:
    el documento entero vectorizado vivia en memoria a la vez, y cada vector
    denso pasaba por `.tolist()`, que infla 1024 floats de 4.096 a 32.824
    bytes. Con lotes, en memoria solo hay `index_lote_upsert` puntos, sea el
    documento de diez paginas o de mil.
    """
    import app.rag.vectorization as vectorization

    monkeypatch.setattr(
        vectorization, "get_settings", lambda: SimpleNamespace(index_lote_upsert=1)
    )

    indexar(db, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert qdrant.lotes == [1, 1]
    # Y no se pierde ninguno por el camino.
    assert len(qdrant.puntos) == 2


# ---------------------------------------------------------------------------
# Fallar pronto: Qdrant se comprueba antes de vectorizar
# ---------------------------------------------------------------------------

class EmbedderEspia:
    """Cuenta cuantas veces se le pidio vectorizar algo."""

    def __init__(self, interno):
        self._interno = interno
        self.llamadas = 0

    def embed(self, textos):
        self.llamadas += 1
        return self._interno.embed(textos)


def test_si_qdrant_no_responde_no_se_vectoriza_nada(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder,
    documentos_frescos
):
    """La comprobacion de la coleccion va primero, y es a proposito.

    Vectorizar un PDF largo son minutos de CPU. Hacerlo para descubrir despues
    que Qdrant esta caido es tirar ese tiempo: ahora el fallo salta en el primer
    segundo.
    """
    def caido(collection_name):
        raise RuntimeError("Qdrant no responde")

    qdrant.collection_exists = caido
    espia = EmbedderEspia(dense_embedder)

    with pytest.raises(FalloIngesta):
        indexar(db, qdrant, converter, chunker, espia, sparse_embedder)

    assert espia.llamadas == 0
    assert qdrant.puntos == []

    doc = documentos_frescos()[0]
    assert doc.state == "error"


def test_el_estado_final_no_depende_de_la_sesion_de_la_peticion(
    db, qdrant, converter, chunker, dense_embedder, sparse_embedder,
    documentos_frescos, monkeypatch
):
    """La indexacion sobrevive a la peticion que la lanzo, y debe cerrar bien.

    Se inutiliza la sesion del test en mitad de la ingesta, que es lo que le
    pasa a la de la peticion cuando el cliente se desconecta y FastAPI ejecuta
    el teardown de la dependencia. El documento tiene que acabar igualmente en
    'indexado': si el estado final se escribiera con esa sesion, se quedaria en
    'pendiente' sin que nadie se enterara.
    """
    from app.services import indexation_service as servicio

    real = servicio.embed_texts

    def embed_tras_cerrar_la_peticion(**kwargs):
        def muerta(*_a, **_k):
            raise RuntimeError("la sesion de la peticion ya no existe")

        monkeypatch.setattr(db, "commit", muerta)
        monkeypatch.setattr(db, "get", muerta)
        return real(**kwargs)

    monkeypatch.setattr(servicio, "embed_texts", embed_tras_cerrar_la_peticion)

    resultado = indexar(db, qdrant, converter, chunker, dense_embedder, sparse_embedder)

    assert resultado == {"status": "indexado", "num_chunks": 2}

    doc = documentos_frescos()[0]
    assert doc.state == "indexado"
    assert doc.num_chunks == 2
