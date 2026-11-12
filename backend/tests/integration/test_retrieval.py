"""app/rag/retrieval.py: lo que sale de Qdrant tiene que llegar a las fuentes."""
from types import SimpleNamespace

from app.rag.retrieval import search_chunks


class CrossEncoderFalso:
    """Puntua cada fragmento con su longitud: basta para fijar un orden."""

    def rerank(self, query, documents):
        return [float(len(d)) for d in documents]


class QdrantConPuntos:
    def __init__(self, payloads: list[dict]):
        self._payloads = payloads

    def query_points(self, **_kwargs):
        return SimpleNamespace(points=[SimpleNamespace(payload=p) for p in self._payloads])


def test_cada_fragmento_trae_su_origen_y_su_documento_id(dense_embedder, sparse_embedder):
    """`origen` se perdia por el camino y las fuentes lo enseñaban vacio."""
    qdrant = QdrantConPuntos([
        {"texto": "corto", "nombre": "a.pdf", "origen": "/docs/a.pdf", "documento_id": 1},
        {"texto": "mas largo", "nombre": "b.pdf", "origen": "/docs/b.pdf", "documento_id": 2},
    ])

    resultado = search_chunks("pregunta", dense_embedder, sparse_embedder, qdrant,
                              CrossEncoderFalso())

    assert [(c["nombre"], c["origen"], c["documento_id"]) for c in resultado] == [
        ("b.pdf", "/docs/b.pdf", 2),
        ("a.pdf", "/docs/a.pdf", 1),
    ]
    # Ninguna indexacion escribe `url`: el origen ya es la ruta o la URL.
    assert all("url" not in c for c in resultado)


def test_un_punto_indexado_antes_de_documento_id_no_rompe_la_busqueda(
    dense_embedder, sparse_embedder
):
    """Hasta reindexar conviven puntos sin documento_id: llegan como None."""
    qdrant = QdrantConPuntos([{"texto": "viejo", "nombre": "a.pdf", "origen": "/docs/a.pdf"}])

    resultado = search_chunks("pregunta", dense_embedder, sparse_embedder, qdrant,
                              CrossEncoderFalso())

    assert resultado[0]["documento_id"] is None
