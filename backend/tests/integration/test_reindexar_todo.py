"""scripts/reindexar_todo.py, contra la base de datos en memoria y Qdrant en
memoria. Nunca toca los datos reales: el cliente de Qdrant y los modelos se
sustituyen antes de llamar a main()."""
from types import SimpleNamespace

import pytest
from qdrant_client import QdrantClient, models

import scripts.reindexar_todo as reindexar
from app.core.config import get_settings
from app.db.crud import document as document_crud
from app.rag.vectorization import COLLECTION_NAME, asegurar_coleccion

pytestmark = pytest.mark.filterwarnings("ignore:Payload indexes have no effect")


class ConverterQueFallaCon:
    def __init__(self, interno, ruta_rota: str):
        self._interno = interno
        self._ruta_rota = ruta_rota

    def convert(self, file_path: str):
        if file_path == self._ruta_rota:
            raise FileNotFoundError(file_path)
        return self._interno.convert(file_path)


@pytest.fixture
def entorno(monkeypatch, session_factory, converter, chunker,
            dense_embedder, sparse_embedder):
    monkeypatch.setattr(get_settings(), "dimension_densa", 4)
    qdrant = QdrantClient(":memory:")
    # main() cierra el cliente al terminar; el test lo necesita despues.
    monkeypatch.setattr(qdrant, "close", lambda: None)

    monkeypatch.setattr(reindexar, "QdrantClient", lambda url: qdrant)
    monkeypatch.setattr(reindexar, "SessionLocal", session_factory)
    monkeypatch.setattr(reindexar, "migrar", lambda: None)
    monkeypatch.setattr(reindexar, "crear_embedder_denso", lambda _s: dense_embedder)
    monkeypatch.setattr(reindexar, "crear_embedder_disperso", lambda _s: sparse_embedder)
    monkeypatch.setattr(reindexar, "crear_chunker", lambda _s: chunker)
    monkeypatch.setattr(
        reindexar, "crear_converter",
        lambda: ConverterQueFallaCon(converter, "/docs/roto.pdf"),
    )
    return qdrant


def test_reindexa_todo_y_sigue_aunque_uno_falle(db, entorno, documentos_frescos):
    document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 1)
    document_crud.crear_documento(db, "/docs/roto.pdf", "roto.pdf", "pdf", 1)
    document_crud.crear_documento(db, "/docs/b.pdf", "b.pdf", "pdf", 1)

    assert reindexar.main([]) == 1

    estados = {d.name: d.state for d in documentos_frescos()}
    assert estados == {"a.pdf": "indexado", "roto.pdf": "error", "b.pdf": "indexado"}
    assert entorno.count(collection_name=COLLECTION_NAME).count == 4


def test_borra_la_coleccion_antes_de_empezar(db, entorno):
    """Los puntos viejos no tienen documento_id: si sobrevivieran, nada podria
    borrarlos ya por documento."""
    asegurar_coleccion(entorno)
    entorno.upsert(collection_name=COLLECTION_NAME, points=[models.PointStruct(
        id="00000000-0000-0000-0000-000000000001",
        vector={
            "dense_vector": [1.0, 0.0, 0.0, 0.0],
            "sparse_vector": models.SparseVector(indices=[1], values=[1.0]),
        },
        payload={"nombre": "viejo.pdf", "origen": "/docs/viejo.pdf"},
    )])
    document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 1)

    reindexar.main([])

    puntos, _ = entorno.scroll(collection_name=COLLECTION_NAME, limit=100, with_payload=True)
    assert len(puntos) == 2
    assert all("documento_id" in p.payload for p in puntos)


def test_desde_json_no_convierte_los_documentos_que_lo_tienen_guardado(db, entorno, monkeypatch):
    from app.services import contenidos

    from tests.conftest import FakeDocumento

    con_json = document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 1).id
    document_crud.crear_documento(db, "/docs/b.pdf", "b.pdf", "pdf", 1)
    convertidos: list[str] = []

    class ConverterQueAnota:
        def convert(self, file_path):
            convertidos.append(file_path)
            return SimpleNamespace(document=FakeDocumento(file_path))

    monkeypatch.setattr(reindexar, "crear_converter", lambda: ConverterQueAnota())
    real = contenidos.cargar_documento
    monkeypatch.setattr(
        contenidos, "cargar_documento",
        lambda doc_id: FakeDocumento("guardado") if doc_id == con_json else real(doc_id),
    )

    assert reindexar.main(["--desde-json"]) == 0

    assert convertidos == ["/docs/b.pdf"]
