# Píldora 17 — Tests del backend y del gateway: niveles y dobles

**Sábado 21-nov-2026 · sesión larga: 30 min de lectura + 2-2,5 h de ejercicio**

## 0. Crítica de la entrega del día 16

No hay entrega del día 16: en `origin/aprendizaje` no existe `entregas/dia-16.md` y en el remoto no hay ninguna rama `ejercicio/dia-*`. Tampoco ha llegado tarde ninguna anterior. Sin nota.

El ejercicio del 16 (el comando *Recargar* en la paleta) sigue valiendo tal cual: `main` no se ha movido desde `#45` (`2cf91a8`, 16-nov).

**Lo que cambia hoy por no tener entregas atrasadas:** el plan dice "escribe el test de tu `/stats` del día 04". Ese endpoint no existe: `grep -rn stats backend/app gateway/app` sale vacío. Así que hoy lo creas, en la versión con capa CRUD separada del día 04, y lo usas como excusa para escribir **un test en cada nivel**. Te doy todo el código de producción, que es lo de menos. Lo que importa hoy son los tests, los experimentos que los rompen y tus respuestas.

Todo lo que cuento está comprobado hoy contra `2cf91a8`. He hecho el ejercicio entero en una copia limpia antes de escribirlo, y las salidas que pego son reales:

- Backend: **188 tests** en verde (36 `unit`, 96 `integration`, 56 `api`) en unos 10 s. Con el ejercicio terminado, **201**.
- Gateway: **66 tests** en verde en 1,4 s. Con el ejercicio terminado, **72**.

---

## 1. Concepto clave: qué sustituyes, y dónde

### 1.1 La pirámide, contada como "qué es real en cada nivel"

Olvida por un momento los nombres (*unit*, *integration*, *e2e*). La pregunta útil es: **en este test, ¿qué piezas son de verdad y cuáles son de mentira?**

| Nivel | Es real | Es de mentira | Qué demuestra |
|---|---|---|---|
| Función pura | La función | Nada (no hay nada que sustituir) | Que la lógica es correcta |
| Servicio + base | El servicio y **SQLite de verdad** (en memoria) | Qdrant, LLM, Docling, embedders | Que las consultas SQL y la orquestación funcionan |
| HTTP | Router, validación de Pydantic, códigos de estado, OpenAPI | Lo mismo que arriba, más `get_db` | Que el **contrato HTTP** es el prometido |
| Sistema | Todo, con Qdrant, Redis y un LLM | Nada | Que el conjunto funciona de verdad |

Cada nivel hacia abajo es más rápido y más preciso al fallar ("falla `completar_estados`"), pero demuestra menos. Cada nivel hacia arriba demuestra más y falla de forma más vaga ("algo da 500"). No hay un nivel bueno: hay que elegir **qué riesgo cubre cada test**.

### 1.2 Los dobles: cinco nombres para "algo que no es lo real"

Gerard Meszaros los clasificó, y conviene usar las palabras con precisión:

- **Dummy:** se pasa para rellenar un argumento y nadie lo usa. En AGENT4U: `app.state.cross_encoder = None`.
- **Stub:** devuelve respuestas fijas. `FakeDenseEmbedder.embed()` devuelve siempre `np.ones(4)`.
- **Spy:** un stub que además **apunta** con qué se le llamó, para comprobarlo después. `LLMFalso.llamadas`, `Espia.llamadas` en `test_modelos.py`.
- **Mock:** lleva las expectativas dentro y falla él solo si no se cumplen. AGENT4U casi no los usa, y es una buena señal: comprobar con `assert` sobre lo que apuntó un spy se lee mejor.
- **Fake:** una implementación **que funciona** pero de forma simplificada. `FakeQdrant` guarda puntos en una lista y sabe filtrar con `must`/`must_not`. `ColaEnMemoria`. `FakeBackendClient`.

Que la suite los llame a casi todos "Fake" no es grave. Lo que sí importa es la consecuencia: **cuanto más listo es un doble, más se parece a una segunda implementación, y más fácil es que mienta**, es decir, que se comporte distinto que lo real sin que nadie se entere. Es el tema de §3.

### 1.3 Tres mecanismos de pytest que vas a ver por todas partes

- **Fixtures.** Una función decorada con `@pytest.fixture`. Un test la pide **por nombre de argumento** (`def test_x(db, qdrant)`) y pytest la construye, encadenando dependencias: `db` pide `session_factory`, que pide `engine`. El código tras un `yield` es la limpieza. `conftest.py` es el fichero donde pytest busca fixtures compartidas, por carpeta: las de `tests/conftest.py` valen para todo, y las de `tests/api/conftest.py`, solo para `api/`.
- **`autouse=True`.** La fixture se aplica a todos los tests de su alcance **sin que la pidan**. Es para lo que no debe depender de que alguien se acuerde.
- **`monkeypatch`.** Cambia un atributo (`monkeypatch.setattr(modulo, "nombre", doble)`) y lo **restaura solo** al terminar el test. Es la forma segura de sustituir un global.

Y uno de FastAPI:

- **`app.dependency_overrides[get_db] = otra_funcion`.** Cuando un endpoint declara `Depends(get_db)`, FastAPI llama a `otra_funcion` en su lugar. Es inyección de dependencias de verdad: el router no se entera.

---

## 2. Cómo está en AGENT4U

### 2.1 Backend: la estructura y la configuración

```text
backend/tests/
  conftest.py         495 líneas · 20 fixtures y todos los dobles compartidos
  unit/               4 ficheros · 36 tests
  integration/        15 ficheros · 96 tests
  api/                conftest.py propio + 6 ficheros · 56 tests
  evaluation/         scripts manuales: pytest NO los recoge (día 20)
```

En `backend/pyproject.toml`:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["."]
# Solo se recolecta test_*.py: deja fuera los scripts manuales de
# tests/evaluation/, que llaman al LLM y a Qdrant reales.
python_files = ["test_*.py"]
```

- `asyncio_mode = "auto"`: cualquier `async def test_...` se ejecuta en un event loop sin decorarlo. Por eso el backend no tiene ningún `@pytest.mark.asyncio`.
- `pythonpath = ["."]`: `import app...` funciona sin instalar el paquete.
- `python_files`: cómo se separa la evaluación manual de la suite. `index_hard_docs.py` no empieza por `test_` y pytest lo ignora.

**No hay `__init__.py` en `tests/` ni en sus subcarpetas.** Con el modo de importación por defecto de pytest, cada fichero de test se importa por su **nombre base**. Dos ficheros `test_stats.py` en carpetas distintas chocan. Lo vas a provocar en el Paso 5.

### 2.2 La base de datos: SQLite en memoria con `StaticPool`

```python
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
```

`sqlite://` sin ruta crea una base **en memoria que vive mientras viva la conexión**. Con el pool normal, cada `Session` pediría una conexión nueva, es decir, una base vacía nueva. `StaticPool` fuerza una sola conexión para todo el test. `check_same_thread=False` hace falta porque el `TestClient` ejecuta los endpoints `def` en otro hilo.

Cada test recibe un `engine` nuevo: **aislamiento total entre tests**, sin limpiar tablas a mano.

### 2.3 La fixture que vigila: `nunca_la_base_de_datos_real`

Es la más importante del repo, y su docstring cuenta por qué existe:

```python
@pytest.fixture(autouse=True)
def nunca_la_base_de_datos_real(monkeypatch, engine, session_factory, tmp_path):
    """Ningun test puede escribir en el sqlite del proyecto.

    `SessionLocal` es un global, y lo usan los servicios que siguen trabajando
    cuando la peticion que los lanzo ya termino: el streaming de la respuesta y
    la indexacion. Un test que llegue a ese codigo escribe en `agent4u.db` de
    verdad.

    Esto no es precaucion teorica. Al dar a la indexacion su propia sesion,
    tres tests marcaron el documento 1 REAL como 'error' con el mensaje del
    doble de Qdrant, ...
```

Redirige `SessionLocal` en **cuatro** módulos (`streaming`, `indexacion`, `cola_arq` y `worker.jobs`), `app.db.session.engine`, y las carpetas `contenidos_dir` y `upload_dir` a un `tmp_path`.

La lección de diseño es incómoda: `dependency_overrides[get_db]` solo cubre el código que recibe la sesión **por inyección**. Todo el que la saca de un global (`SessionLocal()`) se escapa, y hay que perseguirlo módulo a módulo con `monkeypatch`. Si mañana alguien escribe `SessionLocal()` en un quinto módulo, esta red no lo cubre. Vuelve a ello en la pregunta 4.

### 2.4 Los dobles del backend

| Doble | Sustituye a | Tipo real | Detalle que lo hace útil |
|---|---|---|---|
| `FakeQdrant` | `QdrantClient` | fake + spy | Guarda puntos, cuenta `lotes` por `upsert`, filtra en `scroll`. Se construye con `fallar_upsert`/`fallar_delete` para probar errores |
| `FakeDenseEmbedder`, `FakeSparseEmbedder` | fastembed | stub | Vectores fijos de 4 dimensiones |
| `FakeConverter`, `FakeChunker`, `FakeDocumento` | Docling | fake | Lo justo de la API de `DoclingDocument` que usa `contenidos.py` |
| `LLMFalso` | `litellm.completion` | stub + spy | Devuelve trozos o lanza un error, y apunta `model`, `messages`, `stream` y `api_key` |
| `FakeGrafo` | el grafo compilado | stub + spy | `stream()` devuelve `{nodo: lo_que_escribió}` como LangGraph con `stream_mode="updates"`, y **asserta** que se pidió ese modo |
| `ColaEnMemoria` | `ColaArq` | fake | Vive en **código de producción**, `app/services/cola_port.py` |

El comentario de `FakeGrafo` es el mejor del repo sobre dobles: *"si devolviera el estado entero en cada tramo, los tests pasarían aunque `responder` dejara de recomponerlo"*. Un doble tiene que reproducir **la forma** de lo real, o los tests prueban otra cosa.

### 2.5 La capa HTTP: `tests/api/conftest.py`

```python
@pytest.fixture
def client(session_factory, qdrant,
           dense_embedder, sparse_embedder, grafo, llm):
    def _get_db():
        with session_factory() as sesion:
            yield sesion

    app.dependency_overrides[get_db] = _get_db
    app.state.qdrant = qdrant
    ...
    app.state.cola = ColaEnMemoria()

    yield TestClient(app)

    app.dependency_overrides.clear()
```

Tres decisiones:

1. **`TestClient(app)` sin `with`.** Con `with`, Starlette ejecuta el `lifespan`, que descargaría varios GB de modelos y abriría Qdrant y Redis. Sin `with`, el `lifespan` no corre y **el test rellena `app.state` a mano**. El precio: el `lifespan` no lo prueba ningún test.
2. **`dependency_overrides`** para la sesión. Es el único sitio donde la inyección de FastAPI hace el trabajo.
3. **`cliente_async`**, la misma fixture con `httpx.ASGITransport`. `TestClient` es síncrono: cada petición se ejecuta y se espera. Para comprobar que el servidor atiende dos cosas a la vez (`test_indexation_concurrencia.py`) hace falta un event loop de verdad.

Un detalle que verás hoy: `TestClient` tiene `raise_server_exceptions=True` por defecto. Si el endpoint lanza una excepción, **el test recibe la excepción**, no un 500. Con un `response_model` que no valida, verás `ResponseValidationError` en la traza.

### 2.6 Gateway: un doble para un puerto

El gateway está montado con el mismo patrón de puertos y adaptadores que la cola del backend:

- **El puerto:** `BackendClient` en `gateway/app/clients/port.py`, un `Protocol` con `@runtime_checkable` y 15 métodos.
- **El adaptador real:** `HttpBackendClient`, con `httpx`.
- **El doble:** `FakeBackendClient` en `gateway/tests/conftest.py`, con datos en listas.

Y tres estilos de test, uno por capa:

| Fichero | Tests | Qué es real | Cómo |
|---|---|---|---|
| `test_queries.py`, `test_mutations.py` | 16 + 15 | El esquema y los resolvers | `schema.execute(consulta, context_value={"client": fake_client})`. Ni HTTP ni FastAPI |
| `test_http_client.py` | 26 | `HttpBackendClient`, httpx | `httpx.MockTransport(handler)`: httpx no sale a la red, llama a tu función |
| `test_proxy.py` | 4 | El proxy REST, FastAPI | `ASGITransport(app=app)` y un backend falso con `MockTransport` en `app.state.proxy_client` |

A diferencia del backend, `gateway/tests/` **sí** tiene `__init__.py`. Por eso un test del gateway puede hacer `from tests.conftest import FakeBackendClient`, y en el backend eso no funcionaría.

---

## 3. Por qué se montó así (y qué no cuadra)

1. **"Sin red, sin contenedores, sin claves".** Es la regla de `backend/tests/README.md`, y está bien elegida. La suite tarda 10 s, corre en CI sin servicios (`.github/workflows/backend.yml` solo pone `APP_GEMINI_API_KEY: dummy-para-tests`) y no gasta cuota de Gemini.
   - *Alternativa:* *testcontainers*, que levanta un Qdrant y un Redis reales en Docker por test o por sesión.
   - *Coste de no hacerlo:* **ningún test habla con Qdrant de verdad.** La fusión RRF la hace Qdrant dentro de `query_points` con `prefetch`, así que `test_retrieval.py` (2 tests) solo comprueba lo que el backend hace con los puntos que le llegan. Si un día cambias el `prefetch` y la fusión deja de funcionar, la suite no lo ve. Lo cubre, a medias, la evaluación manual del día 20.

2. **SQLite en memoria y no dobles de los CRUD.** Es la decisión más acertada de la suite. Las consultas SQL son código y pueden fallar. Sustituir la base por un diccionario probaría el diccionario.
   - *Coste:* producción también es SQLite, así que aquí no hay brecha. El día que migres a Postgres, la habrá (tipos, `ON CONFLICT`, bloqueos).

3. **Los dobles se escriben a mano, no con `unittest.mock.MagicMock`.** Un `MagicMock` acepta cualquier llamada con cualquier argumento y devuelve otro `MagicMock`: si renombras `collection_exists`, el test sigue en verde. `FakeQdrant` solo tiene los métodos que existen, así que una errata da `AttributeError`.
   - *Coste:* hay que mantenerlos. `conftest.py` tiene 495 líneas.

4. **El `Protocol` del gateway está para que el doble y el real no se separen**, y no hay ningún test que lo compruebe. En el backend sí lo hay (`test_cola_port.py::test_implementa_el_protocolo`). Además, `isinstance` con un `Protocol` solo mira que **existan atributos con esos nombres**: no mira firmas, ni si son `async`. Lo he comprobado: una clase con 15 `lambda` síncronas pasa `isinstance(x, BackendClient)`. Hoy añades el test, y en la pregunta 6 explicas por qué no basta.

### Cosas que no cuadran, comprobadas hoy

- 🔴 **El doble del gateway no puede detectar un cambio de contrato del backend.** `FakeBackendClient` devuelve los diccionarios que **el gateway cree** que devuelve el backend. Si el backend renombra un campo, el backend sigue en verde, el gateway sigue en verde y la app se rompe. No es teórico: lo provocarás en el Paso 9, y verás pasar **los 200 tests del backend** con un campo renombrado. Es el hermano del 🔴 del día 11 (`Documento(**d)` revienta con cualquier campo nuevo), visto desde los tests.
- 🟠 **Los estados de documento están copiados a mano en tres sitios**: `EstadoDocumento` en `backend/app/api/schemas.py`, la unión de tipos de `frontend/src/shared/api/types.ts` y, desde hoy, `ESTADOS` en el doble del gateway. Nadie comprueba que coincidan.
- 🟠 **`backend/tests/README.md` está desactualizado.** Lista 3 ficheros de `integration/` de los 15 que hay, no menciona `test_jobs.py`, `test_cola_port.py`, `test_document_crud.py` ni `test_indexation_concurrencia.py`, y describe dos carpetas, `data/` y `results/`, que **no existen**.
- 🟠 **La clasificación por niveles no cumple su propia definición.** El README dice que `unit/` son *"funciones puras, sin dobles"*. `unit/test_document_crud.py` usa SQLite (la fixture `db`) y `unit/test_cola_port.py` usa `ColaEnMemoria`. Por la definición del README, el primero es de integración.
- 🟠 **Las cifras del README raíz son viejas.** *Calidad y desarrollo* dice 91 tests de backend, 45 de gateway y 88 de vitest. Hoy son 188, 66 y 117. Dice también que `ruff check` del gateway está en verde: con la versión fijada en `uv.lock` (0.16.9), `uv run ruff check .` en `gateway/` da **3 errores** (dos `I001` y un `SIM117`, todos en `tests/`).
- 🟡 **`uvx ruff` no es `uv run ruff`.** `uvx` baja la última versión (hoy, 0.17.6) y en `backend/` da **46 errores** en `app/`. `uv run ruff` usa la fijada (0.15.22) y da *All checks passed!*. Usa siempre `uv run`. La píldora 11 decía `uvx`: tómalo como corregido.
- 🟡 **`ColaEnMemoria` dice que sirve "para el arranque sin Redis"**, y ningún código de `app/` la usa: es un doble de test que vive en un módulo de producción. No hace daño, pero su docstring promete algo que no existe.
- 🟡 **El estado global no se restaura.** `client` limpia `dependency_overrides` pero deja `app.state.qdrant`, `app.state.cola`... del último test. En el gateway, `test_proxy.py` asigna `app.state.proxy_client` cuatro veces y nunca lo deshace. Hoy no rompe nada, porque cada test vuelve a asignar lo que usa. Es el tipo de acoplamiento que un día da un test que pasa solo o falla solo según el orden.
- 🟡 **61 `@pytest.mark.asyncio` que sobran en el gateway**, porque `asyncio_mode = "auto"` ya está en su `pyproject.toml`. Ruido, no error.
- 🟡 **Nadie prueba `/graphql` por HTTP.** Todos los tests del gateway llaman a `schema.execute` directamente, así que `get_context` (el que pone `request.app.state.client` en el contexto) no lo ejecuta ningún test. Lo cubres hoy.

---

## 4. Ejercicio (≈2-2,5 h)

Objetivo: `GET /stats` en el backend y `estadisticas` en el gateway, con **un test en cada nivel**, y tres experimentos que rompen el código a propósito para ver qué test lo detecta y cuál no.

### Paso 0 — Rama y punto de partida (5 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-17 origin/main
(cd backend && uv sync && uv run pytest -q)     # 188 passed
(cd gateway && uv sync && uv run pytest -q)     # 66 passed
```

### Paso 1 — Medir la suite antes de tocarla (15 min)

```bash
cd backend
for d in unit integration api; do echo -n "$d: "; uv run pytest -q tests/$d | tail -1; done
uv run pytest -q --durations=5 | tail -8
uv run pytest --fixtures tests/api/test_documents.py | grep -E "^(client|db|qdrant|grafo|llm|nunca_la)" 
uv run pytest -q tests/api/test_documents.py::test_con_documentos_devuelve_200_y_la_lista --setup-show
cd ..
```

- Anota cuántos tests tiene cada nivel y cuánto tarda.
- Con `--setup-show`, pytest imprime cada fixture que monta y desmonta. Pega la salida y señala en ella `nunca_la_base_de_datos_real`, que el test no ha pedido: ¿por qué aparece?
- El test más lento será `test_el_tokenizer_y_docling_descargan_en_la_carpeta_de_settings`, de unos 2 s. Ábrelo: ¿descarga algo? ¿De dónde salen esos 2 s?

### Paso 2 — El código de producción del backend (15 min)

**2a.** Al **final** de `backend/app/api/schemas.py`:

```python
# --------------------------------------------------------------------------
# Respuestas: estadisticas
# --------------------------------------------------------------------------

class EstadisticasOut(BaseModel):
    """Respuesta de ``GET /stats``: una foto de lo que hay en el sistema."""

    documentos: int = Field(
        ge=0, description="Filas en la tabla 'documents', esten en el estado que esten.",
        examples=[12],
    )
    documentos_por_estado: dict[EstadoDocumento, int] = Field(
        description="Cuantos documentos hay en cada estado conocido. Salen "
                    "todos los estados, aunque valgan 0.",
    )
    fragmentos_indexados: int = Field(
        ge=0, description="Suma de 'num_chunks' de los documentos indexados.", examples=[843],
    )
    conversaciones: int = Field(ge=0, examples=[7])
    mensajes: int = Field(ge=0, examples=[64])
```

**2b.** Crea `backend/app/db/crud/stats.py`:

```python
"""Las cifras de GET /stats que salen de la base de datos.

No importa nada de app.api: la capa de datos no conoce a la HTTP.
"""
from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.conversation import Conversacion, Mensaje
from app.db.models.document import Document


def completar_estados(conteos: dict[str, int], estados: Iterable[str]) -> dict[str, int]:
    """Todos los estados conocidos, con 0 los que no aparecen.

    Funcion pura. Los estados que no estan en `estados` se descartan: no caben
    en el contrato de la respuesta, y el total de documentos ya los cuenta.
    """
    return {estado: conteos.get(estado, 0) for estado in estados}


def contar_todo(db: Session) -> dict:
    conteos = dict(
        db.execute(select(Document.state, func.count()).group_by(Document.state)).all()
    )
    fragmentos = db.scalar(
        select(func.coalesce(func.sum(Document.num_chunks), 0))
        .where(Document.state == "indexado")
    )
    return {
        "conteos": conteos,
        "fragmentos_indexados": fragmentos,
        "conversaciones": db.scalar(select(func.count()).select_from(Conversacion)),
        "mensajes": db.scalar(select(func.count()).select_from(Mensaje)),
    }
```

Fíjate en el reparto: `completar_estados` es **pura** (recibe datos y devuelve datos), así que se prueba sin nada alrededor. `contar_todo` habla con la base, así que se prueba con SQLite. La lista de estados la pasa quien llama, para que `db/` no tenga que importar `app.api.schemas`.

**2c.** Crea `backend/app/api/routers/stats.py`:

```python
from typing import Annotated, get_args

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.schemas import EstadisticasOut, EstadoDocumento
from app.db.crud import stats as stats_crud
from app.db.session import get_db

router = APIRouter(tags=["estadisticas"])


@router.get(
    "/stats",
    response_model=EstadisticasOut,
    summary="Cifras globales del sistema",
    description="Documentos por estado, fragmentos indexados, conversaciones "
                "y mensajes. Solo lectura.",
)
def estadisticas(db: Annotated[Session, Depends(get_db)]):
    # 'def' y no 'async def': FastAPI la ejecuta en su threadpool y el
    # SQLAlchemy sincrono no bloquea el event loop.
    datos = stats_crud.contar_todo(db)
    return {
        "documentos": sum(datos["conteos"].values()),
        "documentos_por_estado": stats_crud.completar_estados(
            datos["conteos"], get_args(EstadoDocumento)
        ),
        "fragmentos_indexados": datos["fragmentos_indexados"],
        "conversaciones": datos["conversaciones"],
        "mensajes": datos["mensajes"],
    }
```

**2d.** En `backend/app/api/main.py`, cambia la línea 5 y añade una al final:

```python
from app.api.routers import conversations, documents, health, indexation, jobs, query, stats
# ... (resto igual)
app.include_router(stats.router)
```

```bash
cd backend
uv run pytest -q                 # 188 passed: no has roto nada, y aún no pruebas nada nuevo
uv run ruff check app            # All checks passed!
```

### Paso 3 — Nivel 1: la función pura (10 min)

Crea `backend/tests/unit/test_stats.py` (sí, con ese nombre: en el Paso 5 verás por qué no se puede quedar así):

```python
"""app/db/crud/stats.py · completar_estados: funcion pura, sin dobles ni base."""
from app.db.crud.stats import completar_estados

ESTADOS = ("en-cola", "indexado", "error")


def test_sin_conteos_salen_todos_los_estados_a_cero():
    assert completar_estados({}, ESTADOS) == {"en-cola": 0, "indexado": 0, "error": 0}


def test_respeta_los_conteos_que_hay():
    assert completar_estados({"indexado": 3}, ESTADOS) == {
        "en-cola": 0, "indexado": 3, "error": 0,
    }


def test_un_estado_desconocido_se_descarta():
    assert "rara" not in completar_estados({"rara": 2, "error": 1}, ESTADOS)


def test_el_orden_es_el_de_los_estados_conocidos():
    assert list(completar_estados({"error": 1, "en-cola": 2}, ESTADOS)) == list(ESTADOS)
```

```bash
uv run pytest -q tests/unit/test_stats.py        # 4 passed
```

Ningún argumento, ninguna fixture: no hay nada que sustituir. Este es el test más barato que existe.

### Paso 4 — Nivel 2: las consultas contra SQLite (15 min)

Crea `backend/tests/integration/test_stats_crud.py`:

```python
"""app/db/crud/stats.py · contar_todo contra SQLite en memoria (fixture `db`)."""
import uuid

from app.db.crud import conversation as conversation_crud
from app.db.crud import document as document_crud
from app.db.crud.stats import contar_todo


def _doc(db, nombre: str):
    return document_crud.crear_documento_encolado(
        db, origen=f"/docs/{nombre}", nombre=nombre, tipo="pdf",
        tamano=100, job_id=str(uuid.uuid4()),
    )


def test_base_vacia_todo_a_cero(db):
    assert contar_todo(db) == {
        "conteos": {}, "fragmentos_indexados": 0, "conversaciones": 0, "mensajes": 0,
    }


def test_agrupa_por_estado(db):
    document_crud.marcar_indexado(db, _doc(db, "a.pdf"), 10)
    document_crud.marcar_indexado(db, _doc(db, "b.pdf"), 5)
    document_crud.marcar_error(db, _doc(db, "c.pdf"), "docling: PDF cifrado")
    _doc(db, "d.pdf")

    assert contar_todo(db)["conteos"] == {"indexado": 2, "error": 1, "en-cola": 1}


def test_solo_suma_fragmentos_de_los_indexados(db):
    document_crud.marcar_indexado(db, _doc(db, "a.pdf"), 10)
    con_restos = _doc(db, "b.pdf")
    con_restos.num_chunks = 99          # un 'en-cola' con basura: no debe contar
    db.commit()

    assert contar_todo(db)["fragmentos_indexados"] == 10


def test_cuenta_conversaciones_y_mensajes(db):
    conv = conversation_crud.crear_conversacion(db, titulo="CAP", usuario="local")
    conversation_crud.anadir_mensaje(db, conv.id, "user", "¿Que es CAP?")
    conversation_crud.anadir_mensaje(db, conv.id, "assistant", "Un teorema.")
    conversation_crud.crear_conversacion(db, titulo="Vacia", usuario="local")

    datos = contar_todo(db)
    assert (datos["conversaciones"], datos["mensajes"]) == (2, 2)
```

```bash
uv run pytest -q tests/integration/test_stats_crud.py     # 4 passed
```

Los datos se crean con el **CRUD real** (`crear_documento_encolado`, `marcar_indexado`...), no con `INSERT` a mano. Así, si el CRUD cambia la forma de los datos, este test lo nota.

### Paso 5 — Nivel 3: el contrato HTTP, y una colisión (20 min)

Crea `backend/tests/api/test_stats.py`:

```python
"""GET /stats a traves del TestClient: el contrato HTTP, no las consultas."""
from app.db.crud import document as document_crud


def test_sin_datos_responde_200_con_todos_los_estados_a_cero(client):
    respuesta = client.get("/stats")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["documentos"] == 0
    assert len(cuerpo["documentos_por_estado"]) == 7
    assert set(cuerpo["documentos_por_estado"].values()) == {0}


def test_refleja_lo_que_hay_en_la_base(client, db):
    doc = document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 10)
    document_crud.marcar_indexado(db, doc, 7)

    cuerpo = client.get("/stats").json()

    assert cuerpo["documentos"] == 1
    assert cuerpo["documentos_por_estado"]["indexado"] == 1
    assert cuerpo["fragmentos_indexados"] == 7


def test_un_estado_desconocido_no_rompe_la_respuesta(client, db):
    """Decision documentada: cuenta en el total, no aparece en el desglose."""
    doc = document_crud.crear_documento(db, "/docs/a.pdf", "a.pdf", "pdf", 10)
    doc.state = "rara"
    db.commit()

    respuesta = client.get("/stats")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["documentos"] == 1
    assert sum(cuerpo["documentos_por_estado"].values()) == 0


def test_aparece_en_openapi_con_su_esquema(client):
    ruta = client.get("/openapi.json").json()["paths"]["/stats"]["get"]

    esquema = ruta["responses"]["200"]["content"]["application/json"]["schema"]
    assert esquema == {"$ref": "#/components/schemas/EstadisticasOut"}
```

Ahora ejecuta **la suite entera**:

```bash
uv run pytest -q
```

Esperado: `1 error during collection`, con este mensaje:

```text
import file mismatch:
imported module 'test_stats' has this __file__ attribute:
  .../backend/tests/unit/test_stats.py
which is not the same as the test file we want to collect:
  .../backend/tests/api/test_stats.py
```

Arréglalo renombrando el de `unit/`:

```bash
git mv tests/unit/test_stats.py tests/unit/test_stats_estados.py 2>/dev/null \
  || mv tests/unit/test_stats.py tests/unit/test_stats_estados.py
find tests -name __pycache__ -prune -exec rm -rf {} +
uv run pytest -q                 # 200 passed
uv run ruff check app tests      # All checks passed!
```

Fíjate en el tercer test: es un **test que documenta una decisión**. Cuando alguien lea la suite, sabrá que un estado desconocido cuenta en el total y no en el desglose, sin tener que preguntar.

### Paso 6 — Romper a propósito: qué test lo detecta (15 min)

Esto es *mutation testing* a mano: introduces un fallo y miras si algún test se pone en rojo. Si ninguno lo hace, tus tests no cubren esa línea, aunque la ejecuten.

Haz cada mutación, ejecuta `uv run pytest -q -k stats`, apunta **qué tests fallan y con qué mensaje**, y deshazla con `git checkout app/db/crud/stats.py`.

1. En `contar_todo`, borra la línea `.where(Document.state == "indexado")`.
2. En `completar_estados`, cambia el `return` por `return {**{e: 0 for e in estados}, **conteos}` (deja pasar los desconocidos).
3. En `contar_todo`, cambia `func.coalesce(func.sum(Document.num_chunks), 0)` por `func.sum(Document.num_chunks)`.

Resultados que he obtenido yo, para que compares:

- Mutación 1: falla **un** test, `test_solo_suma_fragmentos_de_los_indexados`.
- Mutación 2: fallan **dos**, uno unitario con un `AssertionError` claro y uno de API con `ResponseValidationError`. ¿Por qué el de API no da un 500?
- Mutación 3: fallan **tres**. ¿Por qué el de la base vacía falla y el de "refleja lo que hay" no?

### Paso 7 — Gateway: los tests primero, en rojo (15 min)

```bash
cd ../gateway
```

Crea `gateway/tests/test_estadisticas.py`:

```python
"""Query 'estadisticas': puerto, adaptador HTTP, resolver y el /graphql real."""
import httpx

from app.clients.http_client import HttpBackendClient
from app.clients.port import BackendClient
from app.main import app
from app.schema import schema
from tests.conftest import FakeBackendClient

CONSULTA = """
{
  estadisticas {
    documentos
    fragmentos_indexados
    conversaciones
    mensajes
    documentos_por_estado { estado cantidad }
  }
}
"""


# ── nivel 1: el resolver, con el doble del backend ────────────────────


async def test_estadisticas_cuenta_lo_que_tiene_el_backend(fake_client):
    result = await schema.execute(CONSULTA, context_value={"client": fake_client})

    assert result.errors is None
    datos = result.data["estadisticas"]
    assert datos["documentos"] == 1
    assert datos["fragmentos_indexados"] == 12
    assert datos["conversaciones"] == 1


async def test_el_diccionario_por_estado_llega_como_lista_de_pares(fake_client):
    result = await schema.execute(CONSULTA, context_value={"client": fake_client})

    filas = result.data["estadisticas"]["documentos_por_estado"]
    assert {"estado": "indexado", "cantidad": 1} in filas
    assert len(filas) == 7


async def test_un_fallo_del_backend_llega_como_error_graphql(fake_client):
    async def roto() -> dict:
        raise httpx.ConnectError("backend caido")

    fake_client.obtener_estadisticas = roto
    result = await schema.execute(CONSULTA, context_value={"client": fake_client})

    assert result.data is None
    assert result.errors[0].path == ["estadisticas"]


# ── nivel 2: el adaptador HTTP, con un transporte falso ───────────────


async def test_http_client_pide_get_stats():
    vistas: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        vistas.append((request.method, request.url.path))
        return httpx.Response(200, json={"documentos": 0})

    cliente = HttpBackendClient("http://test")
    cliente._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://test"
    )

    assert await cliente.obtener_estadisticas() == {"documentos": 0}
    assert vistas == [("GET", "/stats")]
    await cliente.close()


# ── el contrato entre el doble y el adaptador ─────────────────────────


def test_los_dos_clientes_cumplen_el_protocolo():
    assert isinstance(FakeBackendClient(), BackendClient)
    assert isinstance(HttpBackendClient("http://test"), BackendClient)


# ── nivel 3: por HTTP, por /graphql y get_context ─────────────────────


async def test_por_http_el_endpoint_graphql_usa_el_cliente_de_app_state(fake_client):
    anterior = getattr(app.state, "client", None)
    app.state.client = fake_client
    try:
        transporte = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transporte, base_url="http://gw") as gw:
            resp = await gw.post("/graphql", json={"query": CONSULTA})
    finally:
        app.state.client = anterior

    assert resp.status_code == 200
    assert resp.json()["data"]["estadisticas"]["documentos"] == 1
```

```bash
uv run pytest -q tests/test_estadisticas.py      # esperado: 5 failed, 1 passed
```

Sin `@pytest.mark.asyncio`: el `pyproject.toml` del gateway ya declara `asyncio_mode = "auto"`.

El que pasa es `test_los_dos_clientes_cumplen_el_protocolo`. Apunta por qué (pregunta 6). El último test restaura `app.state.client` en un `finally`: es el arreglo del 🟡 de §3, aplicado a tu código. `ASGITransport` no ejecuta el `lifespan`, así que sin esa asignación `get_context` no encontraría ningún cliente.

### Paso 8 — Gateway: puerto, adaptador, doble, tipo y resolver (15 min)

**8a.** En `gateway/app/clients/port.py`, dentro de `BackendClient`, justo antes de `async def salud`:

```python
    async def obtener_estadisticas(self) -> dict: ...
```

Ejecuta `uv run pytest -q tests/test_estadisticas.py`. Ahora **también** falla el del protocolo: el puerto pide un método que ninguno de los dos clientes tiene. Es la red de seguridad que faltaba.

**8b.** En `gateway/app/clients/http_client.py`, antes del bloque `# ── salud`:

```python
    # ── estadisticas ─────────────────────────────────────────────────

    async def obtener_estadisticas(self) -> dict:
        resp = await self._client.get("/stats")
        resp.raise_for_status()
        return resp.json()
```

**8c.** En `gateway/tests/conftest.py`, justo debajo de `from app.clients.port import BackendHttpError`:

```python
# Los de EstadoDocumento en backend/app/api/schemas.py. Copia a mano: si alli
# cambian, aqui no se entera nadie (ver la pildora 17).
ESTADOS = (
    "en-cola", "indexando", "pendiente", "indexado", "error",
    "duplicado", "pendiente-decision",
)
```

Y dentro de `FakeBackendClient`, antes de `# ── salud`:

```python
    # ── estadisticas ─────────────────────────────────────────────────

    async def obtener_estadisticas(self) -> dict:
        por_estado = dict.fromkeys(ESTADOS, 0)
        for d in self.documentos:
            por_estado[d["state"]] += 1
        return {
            "documentos": len(self.documentos),
            "documentos_por_estado": por_estado,
            "fragmentos_indexados": sum(
                d["num_chunks"] for d in self.documentos if d["state"] == "indexado"
            ),
            "conversaciones": len(self.conversaciones),
            "mensajes": len(self.mensajes),
        }
```

El doble **calcula** a partir de sus propios datos en lugar de devolver una constante: si un test borra un documento del doble, las estadísticas cambian con coherencia.

**8d.** Al final de `gateway/app/schema/types.py`:

```python
@strawberry.type
class EstadoCantidad:
    estado: str
    cantidad: int


@strawberry.type
class Estadisticas:
    documentos: int
    documentos_por_estado: list[EstadoCantidad]
    fragmentos_indexados: int
    conversaciones: int
    mensajes: int
```

**8e.** En `gateway/app/schema/queries.py`, añade al `import` de `app.schema.types`, justo después de `DocumentoRelacionado,`, estas dos líneas **en este orden** (ruff ordena `Estadisticas` antes que `EstadoCantidad`):

```python
    Estadisticas,
    EstadoCantidad,
```

Y al final de la clase `Query`:

```python
    @strawberry.field
    async def estadisticas(self, info: Info) -> Estadisticas:
        client = info.context["client"]
        data = await client.obtener_estadisticas()
        return Estadisticas(
            documentos=data["documentos"],
            documentos_por_estado=[
                EstadoCantidad(estado=estado, cantidad=cantidad)
                for estado, cantidad in data["documentos_por_estado"].items()
            ],
            fragmentos_indexados=data["fragmentos_indexados"],
            conversaciones=data["conversaciones"],
            mensajes=data["mensajes"],
        )
```

```bash
uv run pytest -q                                                    # 72 passed
uv run ruff check app tests/test_estadisticas.py tests/conftest.py  # All checks passed!
```

No ejecutes `ruff check .` entero esperando verde: los 3 errores de `tests/` ya estaban en `main` (§3).

### Paso 9 — El doble que miente, y el test que lo atrapa (15 min)

Simula que alguien renombra un campo en el backend. En `backend/`:

```bash
cd ../backend
sed -i.bak 's/    mensajes: int = Field(ge=0, examples=\[64\])/    num_mensajes: int = Field(ge=0, examples=[64])/' app/api/schemas.py
sed -i.bak 's/        "mensajes": datos\["mensajes"\],/        "num_mensajes": datos["mensajes"],/' app/api/routers/stats.py
grep -n "num_mensajes" app/api/schemas.py app/api/routers/stats.py    # dos líneas
uv run pytest -q                 # ¿cuántos pasan?
(cd ../gateway && uv run pytest -q)
```

(`sed -i.bak` funciona igual en macOS y en Linux, y deja una copia `.bak`.)

Yo obtuve **200 passed** y **72 passed**. Las dos suites en verde, y en la app real el resolver haría `data["mensajes"]` y daría `KeyError`.

Ahora añade al final de `backend/tests/api/test_stats.py` el test que lo habría atrapado:

```python
def test_el_contrato_tiene_exactamente_estos_campos(client):
    """El gateway lee estas claves una a una. Renombrar una es romperle."""
    assert set(client.get("/stats").json()) == {
        "documentos", "documentos_por_estado", "fragmentos_indexados",
        "conversaciones", "mensajes",
    }
```

```bash
uv run pytest -q                 # 1 failed, 200 passed: lo atrapa
mv app/api/schemas.py.bak app/api/schemas.py
mv app/api/routers/stats.py.bak app/api/routers/stats.py
uv run pytest -q                 # 201 passed
```

Es un **test de contrato** de pobre: el proveedor (backend) fija lo que el consumidor (gateway) necesita. Funciona, pero lo tienes que mantener a mano. En la pregunta 7 piensas en algo mejor.

### Paso 10 — Commit (5 min)

```bash
cd ..
git status --short               # sin .bak ni __pycache__
git add backend/app/api/schemas.py backend/app/api/main.py \
        backend/app/api/routers/stats.py backend/app/db/crud/stats.py \
        backend/tests/unit/test_stats_estados.py \
        backend/tests/integration/test_stats_crud.py backend/tests/api/test_stats.py \
        gateway/app gateway/tests/conftest.py gateway/tests/test_estadisticas.py
git commit -m "feat: GET /stats y query estadisticas, con un test por nivel"
git push -u origin ejercicio/dia-17
```

### Bonus (opcional, 20-30 min)

Haz que la fixture `client` de `backend/tests/api/conftest.py` **restaure** `app.state` al terminar. Pista: guarda `vars(app.state._state).copy()` antes y reasígnalo después del `yield`, o usa `monkeypatch.setattr(app.state, "qdrant", qdrant)` en lugar de asignaciones directas (`monkeypatch` deshace solo). Comprueba que siguen pasando los 201 y explica en la entrega qué opción has elegido y por qué.

### Preguntas (respóndelas con tus palabras en la entrega)

1. Para cada uno de tus 13 tests del backend, di en una frase **qué riesgo cubre** que no cubra ningún otro. Si hay alguno que no cubre nada nuevo, dilo y di si lo borrarías.
2. `TestClient(app)` se construye sin `with`. ¿Qué no se ejecuta por eso? ¿Qué parte del arranque real no prueba **ningún** test de la suite? ¿Cómo la probarías sin descargar los modelos?
3. ¿Por qué la fixture `engine` usa `StaticPool`? Explica qué pasaría sin ella, paso a paso, en `test_refleja_lo_que_hay_en_la_base`.
4. `nunca_la_base_de_datos_real` parchea `SessionLocal` en cuatro módulos. ¿Por qué no basta con `dependency_overrides[get_db]`? Propón un cambio en `app/` que hiciera innecesaria esa lista, y di qué cuesta.
5. Resultados de las tres mutaciones del Paso 6: qué falló, y responde a las dos preguntas que dejé allí.
6. ¿Por qué `test_los_dos_clientes_cumplen_el_protocolo` pasaba **antes** de tocar el puerto? ¿Qué comprueba de verdad `isinstance` con un `Protocol` `@runtime_checkable`, y qué no? ¿Qué herramienta del repo sí comprobaría firmas y `async`?
7. El Paso 9 demuestra que el doble del gateway no ve los cambios del backend. Propón **dos** formas de cerrar ese hueco más robustas que tu test de claves (pistas: el `openapi.json` del backend; *consumer-driven contracts*). Para cada una: qué ganas y qué te cuesta mantenerla.
8. Clasifica `FakeQdrant`, `LLMFalso`, `FakeGrafo`, `ColaEnMemoria` y `FakeBackendClient` con la taxonomía de §1.2. Justifica cada una con una línea de su código.

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-17` en el remoto, creada desde `main`.
- [ ] `cd backend && uv run pytest -q` da **201 passed**, y `cd gateway && uv run pytest -q` da **72 passed**.
- [ ] `grep -n "app.api" backend/app/db/crud/stats.py` sale vacío.
- [ ] Hay exactamente un `test_stats.py` en `backend/tests` (`find backend/tests -name test_stats.py | wc -l` da `1`).
- [ ] `uv run ruff check app tests` en `backend/` da *All checks passed!*.
- [ ] La entrega incluye la salida de `--setup-show` del Paso 1 y el error de colisión del Paso 5.
- [ ] La entrega incluye, para cada mutación del Paso 6, los tests que fallaron.
- [ ] La entrega incluye las dos salidas en verde del Paso 9, con el campo renombrado.
- [ ] Las 8 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

### Entrega: antes de las 8:30 del lunes 23-nov

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-17.md
# ...rellénala...
git add docs/aprendizaje/entregas/dia-17.md
git commit -m "entrega día 17" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code (con `XX` = `17`) estando en tu rama `ejercicio/dia-17`.

---

## 5. Para profundizar (opcional)

- pytest, *How to use fixtures* (alcances, `autouse`, `yield`, orden de montaje): <https://docs.pytest.org/en/stable/how-to/fixtures.html>
- FastAPI, *Testing Dependencies with Overrides*: <https://fastapi.tiangolo.com/advanced/testing-dependencies/>

---

## 6. Aportación a `ARCHITECTURE.md`

Hoy abres la sección *12. Testing y evaluación (días 17, 18 y 20)*. Tu párrafo debería cubrir:

- La regla de la suite (sin red, sin contenedores, sin claves) y lo que **cuesta**: nada habla con Qdrant de verdad.
- Los tres niveles del backend por **lo que es real** en cada uno, no por el nombre de la carpeta, y la incoherencia de `unit/test_document_crud.py`.
- SQLite en memoria con `StaticPool` como base de pruebas, y `nunca_la_base_de_datos_real` como red contra los `SessionLocal` globales.
- Los dobles escritos a mano frente a `MagicMock`, y el principio de `FakeGrafo`: el doble tiene que reproducir la **forma** de lo real.
- En el gateway, el `Protocol` como contrato entre doble y adaptador, lo poco que comprueba `isinstance` y el hueco entre el gateway y el backend que demostraste en el Paso 9.

**El lunes 23-nov (día 18):** tests del frontend. Vitest y Testing Library para los componentes, y Playwright con axe para las e2e contra el backend y gateway falsos de `pruebas-e2e/`. Verás que el frontend tiene **su propio** doble del gateway, y te preguntaré si miente igual que el de hoy. El ejercicio: un test unitario y uno e2e.
