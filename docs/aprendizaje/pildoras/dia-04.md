# Píldora 04 — Routers de FastAPI, `Depends` y `app.state`

**Lunes 26-oct-2026 · 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 03

No hay entrega del día 03: en `origin/aprendizaje` no existe `entregas/dia-03.md` y en el remoto no hay rama `ejercicio/dia-03`. Tampoco ha llegado tarde la del 02. Sin nota.

Van dos seguidas, así que te lo digo una vez y sin drama: el plan solo funciona si escribes tú. Si te falta tiempo, entrega **parcial**, que se critica igual y cuenta. Del día 03 la parte que más vale es la **B** (pasos 4 y 5: el test de contrato y `EventoPaso`), que te lleva 45 minutos y cierra un bug real. Lo que sigue pendiente en `main`, comprobado hoy:

- `grep -rn gemini_api_key backend/app` solo devuelve la declaración en `config.py:10`: la clave de Gemini sigue sin llegar a LiteLLM en Docker (día 02, Paso 4).
- Tus cambios al healthcheck siguen en `aprendizaje` y no en `main`: `git diff --stat origin/main origin/aprendizaje -- docker-compose.yml` → `8 insertions(+), 2 deletions(-)`.
- El evento `paso` sigue fuera del contrato SSE (día 03).

El ejercicio de hoy **no depende** del de ayer: sale de `main` limpio.

---

## 1. Concepto clave: cómo llega algo a tu función en FastAPI

Cuando escribes un endpoint, cada parámetro de la firma es una **petición a FastAPI**: "dame esto". FastAPI inspecciona la firma al arrancar y decide de dónde sale cada cosa:

| Parámetro | De dónde lo saca FastAPI |
|---|---|
| `job_id: str` con `{job_id}` en la ruta | De la URL (*path parameter*) |
| `limite: int = 10` sin estar en la ruta | De la *query string* (`?limite=5`) |
| `body: QueryRequest` (un `BaseModel`) | Del cuerpo JSON, validado (día 03) |
| `request: Request` | El objeto petición de Starlette, tal cual |
| `db: Annotated[Session, Depends(get_db)]` | **Llama a `get_db` y te pasa lo que devuelva** |

### 1.1 `Depends`: inyección de dependencias en una línea

`Depends(f)` significa: "antes de llamar al endpoint, llama a `f` y pásame su resultado". Lo importante:

- **`f` puede tener a su vez parámetros** (`Request`, otros `Depends`, query params...). FastAPI resuelve el árbol entero.
- **Se cachea por petición.** Si dos dependencias piden `Depends(get_db)` en la misma petición, `get_db` se ejecuta una vez y las dos reciben la misma sesión (`use_cache=True` por defecto).
- **Si `f` es un generador (`yield`), es un gestor de recursos.** Lo que va antes del `yield` es la apertura, lo que se `yield`-ea es el valor inyectado y el `finally` es el cierre. FastAPI ejecuta el cierre él solo.
- **Se puede sustituir desde fuera**: `app.dependency_overrides[get_db] = otra_funcion`. FastAPI llamará a `otra_funcion` en todos los sitios donde ponga `Depends(get_db)`. Es la herramienta principal de test.

`Annotated[Session, Depends(get_db)]` es la forma moderna (PEP 593): el tipo para ti y para mypy, y el `Depends` como metadato para FastAPI. Y como es un tipo normal, se puede guardar en un alias y reutilizar (lo harás hoy).

### 1.2 ¿Cuándo se cierra una dependencia con `yield`?

Esta es la pregunta trampa, y AGENT4U la responde mal en un comentario (sección 3). Con una respuesta normal (JSON) da igual. Con un `StreamingResponse` no: el endpoint **devuelve** el objeto respuesta enseguida, y el generador que produce los datos se consume **después**, mientras se envía.

En la versión de FastAPI que fija vuestro `uv.lock` (**0.139.2**), lo he medido:

```text
Depends(dep)                   → dep: abre, endpoint devuelve, gen 0, gen 1, dep: cierra
Depends(dep, scope="function") → dep: abre, endpoint devuelve, dep: cierra, gen 0, gen 1
```

Es decir: **por defecto, la sesión sigue abierta hasta que el stream termina** (alcance `"request"`). Si quieres que se cierre en cuanto la función devuelve, se pide explícitamente con `scope="function"`. Lo reproducirás en el Paso 2.

### 1.3 `def` frente a `async def`

FastAPI acepta las dos, y **no son intercambiables**:

- **`def`**: FastAPI la ejecuta en un **hilo del threadpool** de AnyIO (unos 40 hilos por defecto). Puede bloquear (SQLAlchemy síncrono, ficheros, `requests`) sin parar al servidor.
- **`async def`**: se ejecuta **en el event loop**, el único hilo que atiende todas las peticiones. Dentro solo debes hacer cosas que `await`-ees. Una llamada bloqueante ahí (un `db.commit()` síncrono, un `fichero.write`) congela **todas** las peticiones mientras dura.
- Las dependencias siguen la misma regla: una dependencia `def` (o un generador síncrono como `get_db`) se ejecuta en el threadpool **aunque el endpoint sea `async`**. Lo he comprobado: `get_db` corre en `AnyIO worker thread` y el endpoint `async` en el hilo del loop. **La sesión se crea en un hilo y se usa en otro.**
- Si en un `async def` necesitas llamar a algo síncrono, lo mandas al threadpool con `await run_in_threadpool(f, *args)` (de `fastapi.concurrency`).

### 1.4 `app.state`: el cajón de la aplicación

`app.state` es un objeto vacío de Starlette donde puedes colgar lo que quieras (`app.state.qdrant = ...`). Vive lo que vive la app. Desde un endpoint se llega con `request.app.state.qdrant`. Es el sitio natural para lo que se crea **una vez** en el `lifespan` (día 01) y se comparte entre peticiones. Su pega: **no tiene tipos**. `request.app.state.qdrnat` (con la errata) no falla hasta que alguien llama al endpoint, y entonces es un `AttributeError` y un 500.

### 1.5 `APIRouter`

Un `APIRouter` es un "mini FastAPI": declaras rutas en él y luego `app.include_router(router)` las monta en la app. Puede llevar `prefix="/api/v1"`, `tags=[...]` (la agrupación en `/docs`) y `dependencies=[Depends(...)]` (que se ejecutan en todas sus rutas, por ejemplo para autenticación).

---

## 2. Cómo está en AGENT4U

### 2.1 El montaje: `backend/app/api/main.py` (21 líneas)

```python
app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://localhost:5173"], ...)

app.include_router(health.router)
app.include_router(query.router)
app.include_router(indexation.router)
app.include_router(jobs.router)
app.include_router(documents.router)
app.include_router(conversations.router)
```

Seis routers, **ninguno con `prefix`**: las rutas van a la raíz y en español (`/preguntar`, `/documentos`). Cada router solo pone `tags` (por ejemplo, `APIRouter(tags=["indexacion"])` en `indexation.py:22`). No hay `dependencies=` a nivel de router porque no hay autenticación.

### 2.2 El inventario real (sacado de los routers, no del README)

| Router | Endpoint | `def` / `async` | `Depends(get_db)` | Lee de `app.state` |
|---|---|---|---|---|
| `health.py` | `GET /health` | def | — | — |
| | `GET /health/qdrant` | def | — | `qdrant` |
| `query.py` | `GET /ajustes` | def | — | — |
| | `POST /preguntar` | def | ✔ | `dense_embedder`, `sparse_embedder`, `cross_encoder`, `qdrant`, `grafo` |
| `indexation.py` | `POST /indexar` | **async** | ✔ | `cola` |
| | `POST /indexar-url` | **async** | ✔ | `cola` |
| | `POST /indexar-fichero` | **async** | ✔ | `cola` |
| `jobs.py` | `GET /trabajos/{job_id}` | def | ✔ | — |
| `documents.py` | `GET /documentos` | def | ✔ | — |
| | `DELETE /documentos/{documento}` | def | ✔ | `qdrant` |
| `conversations.py` | 4 endpoints (`GET` lista, `GET`/`PATCH`/`DELETE` por id) | def | ✔ | — |

**14 endpoints, 11 con `get_db`, 3 `async`, 11 `def`.** Solo hay **una** dependencia en todo el backend: `get_db`. Todo lo demás (modelos, Qdrant, cola, grafo) se lee a mano de `request.app.state`.

Una curiosidad de la versión: en FastAPI 0.139, `app.routes` ya no lista tus rutas una a una, sino objetos `_IncludedRouter` (los routers incluidos se resuelven de forma perezosa). Si alguna vez inspeccionas rutas por código, recórrelas desde `modulo.router.routes`, no desde `app.routes`.

### 2.3 La única dependencia: `get_db` (`backend/app/db/session.py`)

```python
engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False, "timeout": 30},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

Tres detalles que ahora entiendes:

- **`check_same_thread=False` (línea 16) no es opcional.** SQLite, por defecto, prohíbe usar una conexión desde un hilo distinto del que la creó. Y en FastAPI eso pasa siempre: `get_db` corre en un hilo del threadpool y el endpoint en otro (o en el loop, si es `async`).
- **`timeout: 30`**: si SQLite está bloqueado por otra escritura (el worker escribe en la misma base), la conexión espera hasta 30 segundos antes de dar `database is locked`. Recuérdalo para la sección 3.
- **`expire_on_commit=False`**: después de un `commit`, los objetos conservan sus atributos. Sin esto, `return conv` tras un `commit` provocaría otra consulta al serializar (o un error si la sesión ya está cerrada).

### 2.4 `app.state`: lo que se carga en el `lifespan`

`backend/app/api/lifespan.py:41-75` cuelga **8 objetos** en `app.state`: `dense_embedder`, `sparse_embedder`, `cross_encoder`, `qdrant`, `converter`, `chunker`, `cola` y `grafo`. Después del `yield` cierra `cola` y `qdrant`. Los routers lo leen así:

```python
# routers/query.py:105-115
generador = responder(
    db=db,
    query=body.query,
    conversacion_id=body.conversacion_id,
    dense_embedder=request.app.state.dense_embedder,
    sparse_embedder=request.app.state.sparse_embedder,
    cross_encoder=request.app.state.cross_encoder,
    qdrant=request.app.state.qdrant,
    model=modelo,
    grafo=request.app.state.grafo,
    max_fragmentos=body.max_fragmentos,
)
```

Fíjate en el patrón: **el router saca las piezas de `app.state` y se las pasa al servicio como argumentos**. `query_service.responder` no sabe que existe FastAPI. Es la misma idea que las excepciones de dominio del día 03: la capa HTTP traduce, los servicios trabajan con objetos normales y se pueden probar sin servidor.

`converter` y `chunker` **no los lee ningún router** (`grep -rn "state.converter\|state.chunker" backend/app` solo encuentra el `lifespan`): la indexación la hace el worker, que crea los suyos (`worker/jobs.py:28-29`). Es la herencia de cuando `/indexar` era síncrono, y ya lo viste el día 01.

### 2.5 Cómo lo sustituyen los tests (`backend/tests/api/conftest.py:17-36`)

```python
@pytest.fixture
def client(session_factory, qdrant, converter, chunker,
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

Las **dos** técnicas, una al lado de la otra:

- La sesión se cambia con `dependency_overrides`, porque es una dependencia. El override se limpia al final.
- Todo lo demás se cambia **escribiendo directamente en `app.state`**, porque no son dependencias. `TestClient(app)` se crea **sin** `with`, así que el `lifespan` no se ejecuta y nadie pisa esos dobles con los modelos reales.

Y hay una tercera, la que delata el problema: `tests/conftest.py:78`, `nunca_la_base_de_datos_real`, es un fixture `autouse` que hace `monkeypatch` de `SessionLocal` en **cuatro módulos** (`rag/streaming.py`, `services/indexation_service.py`, `services/cola_arq.py` y `worker/jobs.py`). Esos módulos no usan `get_db`: importan el `SessionLocal` global y abren su propia sesión. Su docstring cuenta que tres tests llegaron a marcar como `error` un documento **real** de `agent4u.db` antes de que existiera. Cuando una pieza no pasa por la inyección, el override no la alcanza, y hay que parchearla módulo a módulo.

### 2.6 Configuración: ni `Depends` ni `app.state`

`get_settings()` (`core/config.py:53-55`) es una función con `@lru_cache()`, y los routers la llaman directamente (`query.py:87`, `indexation.py:43`). Los tests la cambian con `monkeypatch.setattr(get_settings(), "index_max_concurrentes", 0)`: modifican el objeto cacheado, que es el mismo para todos. Funciona porque es un singleton, pero tiene una trampa: si un test olvida el `monkeypatch` y asigna a pelo, el cambio contamina al resto de la sesión de pytest.

---

## 3. Por qué se montó así (y qué no cuadra)

### Decisiones

1. **Un router por área, sin prefijo ni versión.** Es lo mínimo que organiza el código y agrupa `/docs`. La alternativa habitual es `prefix="/api/v1"`, que permite servir una `v2` al lado sin romper a nadie. *Coste de no tenerlo:* las rutas están escritas a mano en el gateway (`gateway/app/proxy.py:8` y `:39`, y `clients/http_client.py`), así que renombrar una ruta del backend rompe el gateway en silencio. En un sistema con un único cliente (tu gateway) es un coste asumible; con clientes de terceros, no.

2. **Lo pesado en `app.state`, cargado una vez en el `lifespan`.** Los tres modelos de fastembed tardan segundos y ocupan cientos de MB: crearlos por petición es inviable. Alternativas:
   - *Variables globales a nivel de módulo:* se cargarían al importar, así que cualquier test que haga `from app.api.main import app` descargaría modelos. Es justo lo que el `lifespan` evita.
   - *Funciones con `@lru_cache` y `Depends`:* perezosas, con tipo y sustituibles con overrides. El precio es que el primer usuario paga la carga, y una sonda de salud no sabe si los modelos están listos.
   - *El estado del `lifespan` de Starlette* (`yield {"qdrant": q}` y `request.state.qdrant`): más explícito, pero igual de poco tipado.

   *Coste de la opción elegida:* `app.state` es `Any`. Mypy no detecta una errata, y cada endpoint necesita `request: Request` solo para llegar al cajón.

3. **Los servicios reciben las piezas como argumentos.** El router hace de "cableado" y el servicio es una función pura de sus entradas. Por eso `tests/integration/` prueba `query_service` sin FastAPI. *Coste:* firmas largas (`responder` recibe 10 argumentos) que se repiten en cada llamada.

4. **Una única dependencia (`get_db`), y el resto a mano.** Es la parte de FastAPI que hay que usar sí o sí para tener una sesión por petición bien cerrada. Para el resto, el proyecto prefirió lo directo. *Coste:* dos mecanismos de sustitución en los tests (override y escribir en `app.state`), más el parche de cuatro módulos para el `SessionLocal` global.

5. **Las tres de indexación son `async` porque tienen que `await`-ear a la cola** (`cola.en_vuelo()` y `cola.encolar()` son corrutinas del `Protocol` `ColaIndexacion`). El resto son `def` porque todo lo que hacen es síncrono (SQLAlchemy, Qdrant, fastembed), y FastAPI las manda al threadpool. Es la regla correcta... salvo por lo que viene abajo.

### Cosas que no cuadran (comprobadas hoy contra `main`)

- 🟠 **Un comentario que explica el diseño con una razón falsa.** El docstring de `responder` (`services/query_service.py:46-51`) dice que *"la sesión la inyecta FastAPI por petición y se cierra en cuanto el endpoint devuelve, mientras que el generador lo consume después StreamingResponse"*. En FastAPI 0.139.2 eso **no es verdad**: con el alcance por defecto, la sesión se cierra cuando el stream **termina** (sección 1.2, y lo compruebas en el Paso 2). El diseño sigue siendo bueno (no conviene tener una sesión viva durante los segundos que tarda el LLM, y `rag/streaming.py` abre la suya solo para guardar la respuesta al final), pero el motivo escrito ya no es cierto. Un comentario que miente es peor que ninguno: el próximo que lo lea "arreglará" algo que no está roto. Lo corriges en el ejercicio.

- 🟠 **Las tres rutas `async` bloquean el event loop.** Dentro de `_encolar_trabajo` (`indexation.py:51`), `document_crud.crear_documento_encolado(...)` (línea 60) hace un `db.commit()` **síncrono** en el hilo del loop. Y en `indexar_fichero`, `salida.write(trozo)` (línea 174) escribe en disco 1 MB cada vez, también síncrono, para ficheros de hasta 50 MB. Lo grave es la combinación con `timeout: 30`: si el worker está escribiendo y SQLite está bloqueado, ese `commit` puede esperar **hasta 30 segundos con el servidor entero congelado**, incluidos los streams de `/preguntar` de otros usuarios. Lo mismo hace `ColaArq.en_vuelo()` (`services/cola_arq.py:33-35`): es `async` de nombre, pero dentro hace una consulta SQLite síncrona. Hoy, con un usuario y SQLite local, no se nota. El día que haya concurrencia, sí. La solución es `run_in_threadpool` para lo síncrono (lo usarás hoy) o un driver asíncrono.

- 🟠 **`DELETE /documentos/{documento}` borra por nombre, y el nombre no es único.** En la tabla, `origin` es `unique=True` pero `name` no (`db/models/document.py:12-13`). Con `/a/informe.pdf` y `/b/informe.pdf` indexados, los dos se llaman `informe.pdf`. Al borrar:
  - `borrar_por_origen` (`rag/vectorization.py:123`) filtra en Qdrant con `should` por `origen` **o** `nombre`, así que borra los vectores de **los dos**.
  - `document_crud.eliminar_documento` (`db/crud/document.py:56-57`) hace `db.scalar(select(...).where(name == ...))`, que devuelve **una** fila, y borra solo esa.

  Resultado: el otro documento queda como `indexado` en la UI sin un solo vector. Y hay un caso más: para `/indexar-url`, el nombre es `os.path.basename(url)`, que para `https://example.com/` vale `''` (comprobado). Ese documento no se puede borrar por la API. El identificador correcto para una ruta es el `id` o el `origin`.

- 🟡 **`try/except Exception → HTTPException(500, detail=str(e))`** en `documents.py:22-25` y `:49-52`. Sin el `try`, FastAPI ya respondería 500. Lo único que añade es enviar al cliente el texto interno de la excepción (rutas, SQL, mensajes de Qdrant).

- 🟡 **El README se queda corto.** `README.md:110` describe `lifespan.py` como *"abre Qdrant/Redis una sola vez"*. Abre eso y además carga tres modelos, el `converter`, el `chunker` y compila el grafo, que es lo que de verdad cuesta. No es grave, pero es la línea que lee alguien que llega nuevo.

---

## 4. Ejercicio (≈40 min): tu endpoint `GET /stats`

**Rama de código:** `ejercicio/dia-04`, creada desde `main`.
**Entrega:** `docs/aprendizaje/entregas/dia-04.md`, en la rama `aprendizaje`, **antes de las 8:30 del miércoles 28-oct**.

Vas a crear un endpoint que devuelva una foto del sistema: documentos por estado, fragmentos indexados, conversaciones, mensajes y trabajos en vuelo. Por el camino tocarás las cuatro piezas de hoy: una **dependencia propia** que envuelve `app.state`, un **esquema de salida**, la diferencia **`def`/`async`** y un **override** en el test. El día 11 lo expondrás por GraphQL y el 17 ampliarás su test, así que hazlo bien.

### Paso 1 — Rama (2 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-04 origin/main
cd backend
uv sync
uv run pytest -q          # punto de partida: 91 passed
```

### Paso 2 — Ver con tus ojos cuándo se cierra una dependencia (7 min)

Guarda este script **fuera del repo** y ejecútalo con el entorno del backend:

```bash
cat > /tmp/orden.py <<'EOF'
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

log = []


def dep():
    log.append("dep: abre")
    try:
        yield "sesion"
    finally:
        log.append("dep: cierra")


app = FastAPI()


def generador():
    for i in range(2):
        log.append(f"gen {i}")
        yield f"{i}\n"


@app.get("/por-defecto")
def por_defecto(d: Annotated[str, Depends(dep)]):
    log.append("endpoint devuelve")
    return StreamingResponse(generador())


@app.get("/funcion")
def funcion(d: Annotated[str, Depends(dep, scope="function")]):
    log.append("endpoint devuelve")
    return StreamingResponse(generador())


c = TestClient(app)
for ruta in ("/por-defecto", "/funcion"):
    log.clear()
    c.get(ruta)
    print(ruta, log)
EOF
uv run python /tmp/orden.py
```

Pega la salida en la entrega. Después abre `app/services/query_service.py` y **corrige el docstring de `responder`** (líneas 46-51) para que diga la verdad: con qué alcance se inyecta la sesión, cuándo se cierra de verdad y **por qué sigue siendo buena idea** leer de la base antes de devolver el generador. Escríbelo con tus palabras, en 3-5 líneas.

### Paso 3 — Una dependencia propia: `app/api/deps.py` (5 min)

Crea `backend/app/api/deps.py`:

```python
"""Dependencias compartidas por los routers.

Envuelven `request.app.state` en funciones con tipo. Asi el endpoint declara
lo que necesita en su firma, mypy sabe que tipo recibe, y un test puede
sustituirlo con `app.dependency_overrides` sin tocar `app.state`.
"""
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.cola_port import ColaIndexacion


def get_cola(request: Request) -> ColaIndexacion:
    return request.app.state.cola


SesionDB = Annotated[Session, Depends(get_db)]
Cola = Annotated[ColaIndexacion, Depends(get_cola)]
```

`SesionDB` y `Cola` son **alias de tipo**: escribir `db: SesionDB` equivale a `db: Annotated[Session, Depends(get_db)]`. No migres los routers existentes: hoy solo lo usa el tuyo.

### Paso 4 — El esquema de salida (5 min)

Al **final** de `backend/app/api/schemas.py`, añade:

```python
# --------------------------------------------------------------------------
# Respuestas: estadisticas
# --------------------------------------------------------------------------

class EstadisticasOut(BaseModel):
    """Respuesta de ``GET /stats``: una foto de lo que hay en el sistema."""

    documentos: int = Field(ge=0, description="Filas en la tabla 'documents'.", examples=[12])
    documentos_por_estado: dict[EstadoDocumento, int] = Field(
        description="Cuantos documentos hay en cada estado. Salen los cinco "
                    "estados siempre, aunque valgan 0.",
        examples=[{"en-cola": 1, "indexando": 0, "pendiente": 0, "indexado": 10, "error": 1}],
    )
    fragmentos_indexados: int = Field(
        ge=0, description="Suma de 'num_chunks' de los documentos indexados.", examples=[843],
    )
    conversaciones: int = Field(ge=0, examples=[7])
    mensajes: int = Field(ge=0, examples=[64])
    trabajos_en_vuelo: int = Field(
        ge=0, description="Lo que responde la cola: trabajos pendientes o ejecutandose.", examples=[1],
    )
```

Fíjate en que las claves del diccionario son `EstadoDocumento`, el `Literal` del día 03. Eso lo usarás en la pregunta 5.

### Paso 5 — Las consultas: `app/db/crud/stats.py` (6 min)

```python
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.conversation import Conversacion, Mensaje
from app.db.models.document import Document


def contar_todo(db: Session) -> dict:
    """Las cifras de GET /stats que salen de la base de datos.

    Consultas agregadas: la base cuenta y suma, y Python no carga ninguna fila
    entera. Solo devuelve los estados que existen en la tabla; rellenar los
    que faltan con 0 es cosa del contrato, no de la consulta.
    """
    por_estado = dict(
        db.execute(select(Document.state, func.count()).group_by(Document.state)).all()
    )
    fragmentos = db.scalar(
        select(func.coalesce(func.sum(Document.num_chunks), 0))
        .where(Document.state == "indexado")
    )
    return {
        "documentos_por_estado": por_estado,
        "fragmentos_indexados": fragmentos,
        "conversaciones": db.scalar(select(func.count()).select_from(Conversacion)),
        "mensajes": db.scalar(select(func.count()).select_from(Mensaje)),
    }
```

Este módulo **no importa nada de `app.api`**. La capa de datos no debe depender de la capa HTTP (pregunta 6).

### Paso 6 — El router y su montaje (6 min)

Crea `backend/app/api/routers/stats.py`:

```python
from typing import get_args

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.api.deps import Cola, SesionDB
from app.api.schemas import EstadisticasOut, EstadoDocumento
from app.db.crud import stats as stats_crud

router = APIRouter(tags=["estadisticas"])


@router.get(
    "/stats",
    response_model=EstadisticasOut,
    summary="Cifras globales del sistema",
    description="Documentos por estado, fragmentos indexados, conversaciones, "
                "mensajes y trabajos en vuelo. Solo lectura.",
)
async def estadisticas(db: SesionDB, cola: Cola):
    # contar_todo usa SQLAlchemy sincrono. Llamado tal cual dentro de un
    # 'async def' bloquearia el event loop mientras SQLite responde, asi que
    # se manda al threadpool.
    datos = await run_in_threadpool(stats_crud.contar_todo, db)

    por_estado = {estado: 0 for estado in get_args(EstadoDocumento)}
    por_estado.update(datos.pop("documentos_por_estado"))

    return {
        **datos,
        "documentos": sum(por_estado.values()),
        "documentos_por_estado": por_estado,
        "trabajos_en_vuelo": await cola.en_vuelo(),
    }
```

Y en `backend/app/api/main.py`, añade `stats` al `import` de routers y una línea más al final:

```python
app.include_router(stats.router)
```

### Paso 7 — El test, con un override (8 min)

Crea `backend/tests/api/test_stats.py`:

```python
"""GET /stats: cifras globales, y como se sustituye una dependencia."""
from app.api.deps import get_cola
from app.api.main import app
from app.db.crud import conversation as conversation_crud
from app.db.crud import document as document_crud


def test_sistema_vacio_responde_ceros(client):
    respuesta = client.get("/stats")

    assert respuesta.status_code == 200
    assert respuesta.json() == {
        "documentos": 0,
        "documentos_por_estado": {
            "en-cola": 0, "indexando": 0, "pendiente": 0, "indexado": 0, "error": 0,
        },
        "fragmentos_indexados": 0,
        "conversaciones": 0,
        "mensajes": 0,
        "trabajos_en_vuelo": 0,
    }


def test_cuenta_documentos_conversaciones_y_mensajes(client, db):
    listo = document_crud.crear_documento_encolado(
        db, origen="/docs/a.pdf", nombre="a.pdf", tipo="pdf", tamano=1, job_id="j-1",
    )
    document_crud.marcar_indexado(db, listo, num_chunks=7)
    document_crud.crear_documento_encolado(
        db, origen="/docs/b.pdf", nombre="b.pdf", tipo="pdf", tamano=1, job_id="j-2",
    )
    conv = conversation_crud.crear_conversacion(db, titulo="Prueba", usuario="local")
    conversation_crud.anadir_mensaje(db, conv.id, rol="user", contenido="hola")
    conversation_crud.anadir_mensaje(db, conv.id, rol="assistant", contenido="buenas")

    cuerpo = client.get("/stats").json()

    assert cuerpo["documentos"] == 2
    assert cuerpo["documentos_por_estado"]["indexado"] == 1
    assert cuerpo["documentos_por_estado"]["en-cola"] == 1
    assert cuerpo["fragmentos_indexados"] == 7
    assert cuerpo["conversaciones"] == 1
    assert cuerpo["mensajes"] == 2


class ColaConTres:
    async def en_vuelo(self) -> int:
        return 3


def test_trabajos_en_vuelo_sale_de_la_cola(client):
    app.dependency_overrides[get_cola] = ColaConTres

    assert client.get("/stats").json()["trabajos_en_vuelo"] == 3
```

```bash
uv run pytest -q tests/api/test_stats.py     # 3 passed
```

Fíjate en que no hace falta limpiar el override de `get_cola`: el fixture `client` hace `app.dependency_overrides.clear()` al terminar (`tests/api/conftest.py:36`).

**Experimento (2 min):** en el router, cambia temporalmente `await run_in_threadpool(stats_crud.contar_todo, db)` por `stats_crud.contar_todo(db)` y vuelve a ejecutar los tests. ¿Pasan? Deshaz el cambio y responde a la pregunta 3 con eso en mente.

### Paso 8 — Validar y subir (3 min)

```bash
uv run pytest -q                  # 94 passed (91 + tus 3)
uv run ruff check app tests       # All checks passed!
cd ..
git add backend/app/api/deps.py backend/app/api/schemas.py backend/app/api/main.py \
        backend/app/api/routers/stats.py backend/app/db/crud/stats.py \
        backend/app/services/query_service.py backend/tests/api/test_stats.py
git diff --cached --stat          # 7 ficheros, ni uno más
git commit -m "feat(api): GET /stats con dependencia de cola tipada; corrige docstring de responder"
git push -u origin ejercicio/dia-04
```

### Preguntas (responde con tus palabras en la entrega)

1. Cuenta, paso a paso, qué hace FastAPI con `db: Annotated[Session, Depends(get_db)]` desde que llega la petición hasta que se ejecuta el `finally` de `get_db`. ¿En qué momento exacto se cierra la sesión en `POST /preguntar`? ¿Y si se declarara con `scope="function"`?
2. ¿Por qué `get_db` es un generador con `yield` y no un simple `return SessionLocal()`? ¿Qué se rompería, y cuándo se notaría?
3. `/stats` es `async def`. ¿Por qué no puede ser `def` tal como está escrito? En el experimento del Paso 7, los tests pasaron sin `run_in_threadpool`: ¿significa eso que no hacía falta? ¿Qué pasaría en producción con el worker escribiendo y el `timeout: 30` de `session.py`? Relaciónalo con las tres rutas de `indexation.py`.
4. ¿Qué ganas con `Depends(get_cola)` frente a leer `request.app.state.cola` dentro del endpoint? Da al menos dos ventajas concretas, y di qué no resuelve (pista: ¿quién rellena `app.state.cola`?).
5. Si en la tabla hubiera un documento con `state="rara"` (por ejemplo, alguien lo escribe a mano en SQLite), ¿qué devolvería `/stats`, y por qué? ¿Te parece el comportamiento correcto o lo cambiarías?
6. ¿Por qué `contar_todo` cuenta en SQL (`func.count`, `group_by`) en lugar de hacer `len(listar_documentos(db))`? ¿Y por qué no importa `EstadoDocumento` de `app.api.schemas`?
7. Explica con tus palabras el bug de `DELETE /documentos/{documento}` con dos ficheros `informe.pdf` en carpetas distintas. ¿Qué cambiarías: el parámetro de la ruta, la consulta o el filtro de Qdrant? No hace falta que lo implementes.

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-04` en el remoto, creada desde `main` (`git merge-base --is-ancestor origin/main origin/ejercicio/dia-04`).
- [ ] Salida del Paso 2 pegada en la entrega, con los dos órdenes distintos.
- [ ] Docstring de `responder` corregido: ya no afirma que la sesión se cierra cuando el endpoint devuelve.
- [ ] `app/api/deps.py` con `get_cola`, `SesionDB` y `Cola`; el router de `/stats` los usa en su firma y no recibe `Request`.
- [ ] `EstadisticasOut` en `schemas.py` y `GET /stats` declarado con `response_model=EstadisticasOut`.
- [ ] `app/db/crud/stats.py` no importa nada de `app.api` (`grep -n "app.api" backend/app/db/crud/stats.py` vacío).
- [ ] `uv run pytest -q` con 94 en verde y `uv run ruff check app tests` limpio (pega los resúmenes).
- [ ] `git diff --stat origin/main origin/ejercicio/dia-04` muestra solo los 7 ficheros del Paso 8.
- [ ] Las 7 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

Entrega (antes de las 8:30 del **miércoles 28-oct**):

```bash
git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-04.md
# ...rellena dia-04.md: salida del Paso 2, resúmenes de pytest y ruff, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-04.md
git commit -m "entrega día 04" && git push
```

Si quieres feedback antes de entregar, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code con `XX = 04`, estando en tu rama `ejercicio/dia-04`.

---

## 5. Para profundizar (opcional)

- FastAPI, *Dependencies with yield* (incluye el alcance `scope` y cuándo se ejecuta el cierre): https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/
- FastAPI, *Concurrency and async / await* (cuándo usar `def` y cuándo `async def`): https://fastapi.tiangolo.com/async/

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la segunda mitad de la sección *3. API: contratos y routers* debería cubrir:

- Cómo se monta la API: seis routers por área, sin prefijo, incluidos en `main.py`, y el reparto de 14 endpoints entre `def` (threadpool) y `async def` (event loop), con el motivo de cada uno.
- Las dos vías por las que un endpoint recibe sus piezas: `Depends(get_db)` para la sesión por petición, y `request.app.state` para lo que el `lifespan` carga una vez. Qué implica cada una para los tests (override frente a escribir en `app.state`, y el parche de `SessionLocal` en cuatro módulos).
- La regla que te llevas: nada síncrono y bloqueante dentro de un `async def` sin `run_in_threadpool`, y dónde se incumple hoy.

Si aún no has escrito el párrafo del día 03, júntalos: es la misma sección.

**El miércoles 28-oct (día 05):** ingesta asíncrona, de la API a la cola, de la cola a Redis/ARQ y de ahí al worker. Seguirás un documento desde `POST /indexar` hasta su estado final con `GET /trabajos/{id}`, forzarás un 429, y veremos el bug del 409 en `/indexar-fichero` que quedó pendiente el sábado.
