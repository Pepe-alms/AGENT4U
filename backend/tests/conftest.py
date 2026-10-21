"""Fixtures y dobles compartidos por la suite automatica.

Ningun test de esta suite toca servicios reales: la base de datos es SQLite
en memoria y Qdrant, el LLM y docling se sustituyen por los dobles definidos
aqui. Todo debe poder ejecutarse sin red y sin contenedores levantados.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from types import SimpleNamespace

import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Importar el modulo de conversaciones registra sus tablas en el mismo Base.
from app.db.crud import document as document_crud
from app.db.models import conversation as _conversation_models  # noqa: F401
from app.db.models.document import Base


# ---------------------------------------------------------------------------
# Base de datos en memoria
# ---------------------------------------------------------------------------

@pytest.fixture
def engine():
    """SQLite en memoria con una unica conexion compartida.

    StaticPool es imprescindible: sin el, cada sesion abriria su propia
    conexion y por tanto su propia base de datos vacia.
    """
    motor = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(motor)
    yield motor
    motor.dispose()


@pytest.fixture
def session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def db(session_factory):
    with session_factory() as sesion:
        yield sesion


@pytest.fixture
def documentos_frescos(session_factory):
    """Lee los documentos con una sesion nueva, como hace una peticion real.

    No es un adorno: el estado final lo escribe la indexacion con su propia
    sesion (ver `_marcar_estado`). La sesion del test tiene ese mismo documento
    en su identity map desde antes de aquel commit, y SQLAlchemy no sobreescribe
    atributos que ya estaban cargados. Leer por ahi devuelve 'pendiente' aunque
    en la base ponga 'error', y el test da por roto codigo que funciona.

    Me costo un rato: el test del camino de error fallaba y el del camino bueno
    pasaba, con el mismo codigo debajo. El que pasaba lo hacia por suerte.
    """
    def leer():
        with session_factory() as sesion:
            return document_crud.listar_documentos(sesion)

    return leer


@pytest.fixture(autouse=True)
def nunca_la_base_de_datos_real(monkeypatch, session_factory):
    """Ningun test puede escribir en el sqlite del proyecto.

    `SessionLocal` es un global, y lo usan los servicios que siguen trabajando
    cuando la peticion que los lanzo ya termino: el streaming de la respuesta y
    la indexacion. Un test que llegue a ese codigo escribe en `agent4u.db` de
    verdad.

    Esto no es precaucion teorica. Al dar a la indexacion su propia sesion,
    tres tests marcaron el documento 1 REAL como 'error' con el mensaje del
    doble de Qdrant, porque el `doc_id` de la base en memoria coincidia con uno
    de la buena. Hubo que repararlo a mano.

    Autouse a proposito: que no dependa de que cada test se acuerde de pedirlo.
    """
    import app.rag.streaming as streaming
    import app.services.indexation_service as indexacion
    import app.services.cola_arq as cola_arq
    import app.worker.jobs as worker_jobs

    monkeypatch.setattr(streaming, "SessionLocal", session_factory)
    monkeypatch.setattr(indexacion, "SessionLocal", session_factory)
    monkeypatch.setattr(cola_arq, "SessionLocal", session_factory)
    monkeypatch.setattr(worker_jobs, "SessionLocal", session_factory)


# ---------------------------------------------------------------------------
# Historial de conversacion
# ---------------------------------------------------------------------------

@dataclass
class MensajeFalso:
    """Los prompts leen del historial solo .rol y .contenido."""
    rol: str
    contenido: str


@pytest.fixture
def mensajes_previos() -> list[MensajeFalso]:
    return [
        MensajeFalso(rol="user", contenido="¿Que es CAP?"),
        MensajeFalso(rol="assistant", contenido="Un teorema de sistemas distribuidos."),
    ]


# ---------------------------------------------------------------------------
# Doble de Qdrant
# ---------------------------------------------------------------------------

class FakeQdrant:
    """Doble de QdrantClient: registra las operaciones en vez de ejecutarlas."""

    def __init__(self, *, coleccion_existe: bool = True,
                 fallar_delete: bool = False, fallar_upsert: bool = False):
        self.coleccion_existe = coleccion_existe
        self.fallar_delete = fallar_delete
        self.fallar_upsert = fallar_upsert
        self.puntos: list = []
        # Cuantos puntos trajo cada `upsert`. Importa aparte de `puntos`:
        # subir 400 de golpe o en dos lotes de 200 da el mismo total y muy
        # distinta memoria.
        self.lotes: list[int] = []
        self.colecciones_creadas: list[str] = []
        self.borrados: list[str] = []
        self.filtros_borrado: list = []

    def collection_exists(self, collection_name: str) -> bool:
        return self.coleccion_existe

    def create_collection(self, collection_name: str, **_kwargs) -> None:
        self.coleccion_existe = True
        self.colecciones_creadas.append(collection_name)

    def upsert(self, collection_name: str, points: list) -> None:
        if self.fallar_upsert:
            raise RuntimeError("Qdrant rechazo el upsert")
        self.lotes.append(len(points))
        self.puntos.extend(points)

    def delete(self, collection_name: str, points_selector) -> None:
        if self.fallar_delete:
            raise RuntimeError("Qdrant no responde")
        self.borrados.append(collection_name)
        self.filtros_borrado.append(points_selector)


@pytest.fixture
def qdrant():
    return FakeQdrant()


@pytest.fixture
def qdrant_que_falla_al_subir():
    return FakeQdrant(fallar_upsert=True)


@pytest.fixture
def qdrant_que_falla_al_borrar():
    return FakeQdrant(fallar_delete=True)


@pytest.fixture
def qdrant_sin_coleccion():
    return FakeQdrant(coleccion_existe=False)


# ---------------------------------------------------------------------------
# Dobles de docling (converter / chunker)
# ---------------------------------------------------------------------------

@dataclass
class FakeLabel:
    value: str


@dataclass
class FakeProv:
    page_no: int


@dataclass
class FakeDocItem:
    label: FakeLabel
    prov: list[FakeProv]


@dataclass
class FakeMeta:
    doc_items: list[FakeDocItem]
    headings: list[str] | None = None


@dataclass
class FakeChunk:
    text: str
    meta: FakeMeta


def texto_largo(prefijo: str) -> str:
    """normalize_text descarta cualquier fragmento de menos de 100 caracteres."""
    return prefijo + " " + "contenido de relleno para superar el minimo. " * 4


def hacer_chunk(texto: str, *, paginas=(1,), etiqueta: str = "text",
                headings: list[str] | None = None) -> FakeChunk:
    items = [FakeDocItem(label=FakeLabel(etiqueta), prov=[FakeProv(p) for p in paginas])]
    return FakeChunk(text=texto, meta=FakeMeta(doc_items=items, headings=headings))


class FakeConverter:
    def convert(self, file_path: str):
        return SimpleNamespace(document=SimpleNamespace(origen=file_path))


class FakeChunker:
    def __init__(self, chunks: list[FakeChunk]):
        self._chunks = chunks

    def chunk(self, dl_doc):
        return list(self._chunks)

    def contextualize(self, chunk: FakeChunk) -> str:
        return chunk.text


@pytest.fixture
def converter():
    return FakeConverter()


@pytest.fixture
def chunker():
    """Tres fragmentos, uno de ellos ruido de cabecera que debe descartarse."""
    return FakeChunker([
        hacer_chunk(texto_largo("Primer fragmento util."), paginas=(1, 2), headings=["Intro"]),
        hacer_chunk(texto_largo("Cabecera repetida."), etiqueta="page_header"),
        hacer_chunk(texto_largo("Segundo fragmento util."), paginas=(3,)),
    ])


# ---------------------------------------------------------------------------
# Dobles de los embedders
# ---------------------------------------------------------------------------

class FakeSparseVector:
    def __init__(self):
        self.indices = np.array([1, 2])
        self.values = np.array([0.5, 0.5])


class FakeDenseEmbedder:
    def embed(self, textos):
        return [np.ones(4) for _ in textos]


class FakeSparseEmbedder:
    def embed(self, textos):
        return [FakeSparseVector() for _ in textos]


@pytest.fixture
def dense_embedder():
    return FakeDenseEmbedder()


@pytest.fixture
def sparse_embedder():
    return FakeSparseEmbedder()


# ---------------------------------------------------------------------------
# Doble del LLM (litellm en modo streaming)
# ---------------------------------------------------------------------------

def trozos_llm(*textos: str):
    """Construye la respuesta troceada que devuelve litellm con stream=True."""
    return [
        SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=t))])
        for t in textos
    ]


@dataclass
class LLMFalso:
    """Sustituye a litellm.completion y guarda con que se le llamo."""
    trozos: list = field(default_factory=list)
    error: Exception | None = None
    llamadas: list = field(default_factory=list)

    def __call__(self, *, model, messages, stream=False, **_kwargs):
        self.llamadas.append({"model": model, "messages": messages, "stream": stream})
        if self.error is not None:
            raise self.error
        return iter(self.trozos)


# ---------------------------------------------------------------------------
# Doble del grafo de LangGraph
# ---------------------------------------------------------------------------

class FakeGrafo:
    """Sustituye al grafo compilado: devuelve un estado fijo y anota la entrada.

    Expone `stream` ademas de `invoke` porque es lo que usa `responder`: con
    `stream_mode="updates"` LangGraph entrega un `{nodo: lo_que_escribio}` por
    cada nodo que termina, no el estado completo. Replicar esa forma es lo que
    hace que el doble sirva para algo: si devolviera el estado entero en cada
    tramo, los tests pasarian aunque `responder` dejara de recomponerlo.
    """

    def __init__(self, resultado: dict, tramos: list[dict] | None = None):
        self.resultado = resultado
        self.estados_recibidos: list[dict] = []
        # Por defecto, un nodo por clave del resultado: el minimo que recompone
        # el estado del que vive `responder_stream`.
        self._tramos = tramos if tramos is not None else [
            {"construir": {"messages": resultado.get("messages", [])}},
            {"fusionar": {"chunks": resultado.get("chunks", [])}},
        ]

    def invoke(self, estado: dict) -> dict:
        self.estados_recibidos.append(estado)
        return self.resultado

    def stream(self, estado: dict, stream_mode: str = "values"):
        assert stream_mode == "updates", (
            f"responder() pide 'updates'; recibido {stream_mode!r}"
        )
        self.estados_recibidos.append(estado)
        return iter(self._tramos)


@pytest.fixture
def grafo():
    """Grafo que devuelve un contexto ya resuelto, sin busqueda ni LLM."""
    return FakeGrafo({
        "messages": [{"role": "user", "content": "Contexto + pregunta"}],
        "chunks": [
            {"nombre": "cap.pdf", "origen": "/docs/cap.pdf",
             "headings": ["Teorema CAP"], "paginas": [7], "chunk": "CAP dice que...", "score": 0.9},
        ],
    })


@pytest.fixture
def grafo_con_pasos(grafo):
    """El mismo grafo, pasando por todos los nodos que emiten cifras.

    Sirve para comprobar los eventos 'paso' sin tener que montar el grafo real.
    """
    grafo._tramos = [
        {"multiconsulta": {"subconsultas": ["a", "b", "c"]}},
        {"buscar": {"chunks_parciales": [{}, {}]}},
        {"fusionar": {"chunks": grafo.resultado["chunks"]}},
        {"evaluar": {"valor_maximo": 4.5, "contexto_pobre": False}},
        {"construir": {"messages": grafo.resultado["messages"]}},
    ]
    return grafo


# ---------------------------------------------------------------------------
# Redireccion del streaming a la base de datos de test
# ---------------------------------------------------------------------------

@pytest.fixture
def streaming_en_memoria(monkeypatch, session_factory):
    """responder_stream persiste la respuesta con su propio SessionLocal global.

    Sin esta redireccion escribiria en el sqlite real del proyecto en vez de
    en la base de datos en memoria del test.
    """
    import app.rag.streaming as streaming

    monkeypatch.setattr(streaming, "SessionLocal", session_factory)
    return streaming


@pytest.fixture
def llm(monkeypatch, streaming_en_memoria):
    """Sustituye litellm.completion por un doble que devuelve dos trozos."""
    doble = LLMFalso(trozos=trozos_llm("Hola", " mundo"))
    monkeypatch.setattr(streaming_en_memoria.litellm, "completion", doble)
    return doble


@pytest.fixture
def llm_que_falla(monkeypatch, streaming_en_memoria):
    doble = LLMFalso(error=RuntimeError("el proveedor devolvio 429"))
    monkeypatch.setattr(streaming_en_memoria.litellm, "completion", doble)
    return doble


# ---------------------------------------------------------------------------
# Utilidades SSE
# ---------------------------------------------------------------------------

def _parsear_sse(lineas) -> list[dict]:
    """Convierte los frames 'data: {...}' del stream en diccionarios."""
    eventos = []
    for linea in lineas:
        for trozo in linea.strip().split("\n\n"):
            trozo = trozo.strip()
            if trozo.startswith("data:"):
                eventos.append(json.loads(trozo[len("data:"):].strip()))
    return eventos


@pytest.fixture
def parsear_sse():
    """Se expone como fixture para no tener que importar entre ficheros de test."""
    return _parsear_sse
