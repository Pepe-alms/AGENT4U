# Píldora 11 — El gateway GraphQL (Strawberry): por qué un BFF

**Lunes 9-nov-2026 · 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 10

No hay entrega del día 10: en `origin/aprendizaje` no existe `entregas/dia-10.md` y en el remoto no hay ninguna rama `ejercicio/dia-*`. Tampoco han llegado tarde las anteriores (02 a 09). Sin nota.

Una consecuencia práctica: el ejercicio de hoy pedía exponer "tu `/stats` del día 04" por GraphQL, y ese endpoint no existe. Lo crearás en el Paso 2 en una versión mínima (8 minutos, código completo), sin la dependencia de cola ni el CRUD separado del día 04. Así el resto del ejercicio, que es lo que importa hoy, no depende de nada atrasado.

`main` sigue en `fb93eea` (21-oct). Todo lo de esta píldora lo he comprobado hoy contra ese código, con las versiones de `gateway/uv.lock` (`strawberry-graphql 0.336.2`, `graphql-core 3.3.0`, `fastapi 0.153.0`, `httpx 0.28.1`). Las salidas pegadas son reales: he hecho el ejercicio entero en una rama de usar y tirar antes de escribirlo.

---

## 1. Concepto clave: GraphQL como *Backend For Frontend*

### 1.1 Qué es un BFF

Un **BFF** (*Backend For Frontend*) es un servicio que existe **para un cliente concreto**: se sienta entre ese frontend y los servicios de dominio y les da a las pantallas la forma de datos que necesitan. No tiene lógica de negocio propia. Su trabajo es **traducir, agregar y proteger**:

- **Traducir**: el frontend habla un protocolo (aquí GraphQL) y los servicios otro (aquí REST).
- **Agregar**: una pantalla que necesita tres recursos hace una petición, no tres.
- **Proteger**: es el único punto expuesto, así que ahí van CORS, autenticación, límites y la ocultación de detalles internos.

El coste también es claro: **un salto de red más** y **un sitio más donde mantener el contrato**. Cada campo nuevo del backend hay que declararlo también en el BFF.

### 1.2 GraphQL en cinco ideas

1. **Un solo endpoint**, `POST /graphql`. Lo que cambia es el cuerpo: `{"query": "...", "variables": {...}}`.
2. **Un esquema tipado** (SDL) que describe todo lo que se puede pedir. `Query` agrupa las lecturas y `Mutation` las escrituras.
3. **El cliente elige los campos.** `{ documentos { name state } }` devuelve solo esos dos campos. Nada de *over-fetching*.
4. **Cada campo tiene un *resolver***, una función que sabe obtener su valor. Los campos raíz de una `query` se pueden resolver en paralelo. Los de una `mutation` van siempre en serie, en el orden escrito.
5. **Los errores no son códigos HTTP.** Una respuesta GraphQL llega con **HTTP 200** y trae `data` y, si algo falla, `errors: [{message, path, extensions}]`. Si un campo **no nulo** (`Int!`) falla, el `null` sube hasta el primer padre que admita nulos. Si no hay ninguno, `data` entera se queda en `null`. Lo vas a ver en el ejercicio.

### 1.3 Strawberry en una tabla

Strawberry construye el esquema a partir de **clases Python con anotaciones de tipo**, el enfoque *code-first*. La alternativa *schema-first* sería escribir el SDL a mano.

| Pieza | Qué hace | En AGENT4U |
|---|---|---|
| `@strawberry.type` | Convierte una clase en un tipo GraphQL. Por debajo es un `dataclass`. | Todo `schema/types.py` |
| `@strawberry.field` en un método | Declara un campo con *resolver*. Los argumentos del método son los argumentos del campo. | `Query.*` en `schema/queries.py` |
| `@strawberry.mutation` | Lo mismo, pero en `Mutation`. | `schema/mutations.py` |
| `strawberry.Schema(...)` | Ensambla `Query` y `Mutation` y valida el conjunto. | `schema/__init__.py` |
| `GraphQLRouter` | Monta el esquema como un router de FastAPI. Sirve el IDE GraphiQL en `GET` desde el navegador. | `main.py:39-40` |
| `Info` / `context` | El objeto que recibe cada resolver; `info.context` es lo que devuelve `context_getter`. | `get_context` en `main.py:26-27` |

Traducción de tipos: `int` → `Int!`, `str | None` → `String`, `list[X]` → `[X!]!`. Todo es **no nulo salvo que pongas `| None`**. Y no hay tipo "diccionario": GraphQL no tiene *maps*. Esto te va a obligar a tomar una decisión en el ejercicio.

---

## 2. Cómo está en AGENT4U

### 2.1 El mapa del gateway

```text
gateway/app/
├── main.py              41 líneas  lifespan, CORS, /graphql y el proxy
├── config.py            14         Settings con prefijo GATEWAY_ (solo backend_url)
├── proxy.py             62         POST /preguntar (SSE) y POST /indexar-fichero (multipart)
├── clients/
│   ├── port.py          30         Protocol BackendClient + BackendHttpError
│   └── http_client.py  113         HttpBackendClient: un método por endpoint REST
└── schema/
    ├── __init__.py      11         strawberry.Schema(auto_camel_case=False)
    ├── types.py        101         12 tipos, espejo de los *Out del backend
    ├── queries.py       75         6 queries
    └── mutations.py     69         5 mutations
```

Las cuentas cuadran con el backend. El backend tiene **14 operaciones REST** y todas tienen camino desde el frontend:

| Backend REST | Gateway |
|---|---|
| `GET /ajustes`, `GET /documentos`, `GET /trabajos/{id}`, `GET /conversaciones`, `GET /conversaciones/{id}` | queries `ajustes`, `documentos`, `trabajo`, `conversaciones`, `conversacion` |
| `GET /health` + `GET /health/qdrant` | **una** query `salud`, que llama a los dos |
| `POST /indexar`, `POST /indexar-url`, `DELETE /documentos/{n}`, `DELETE /conversaciones/{id}`, `PATCH /conversaciones/{id}` | mutations `indexar`, `indexar_url`, `eliminar_documento`, `eliminar_conversacion`, `renombrar_conversacion` |
| `POST /preguntar` (SSE), `POST /indexar-fichero` (multipart) | **sin GraphQL**: `proxy.py` los reenvía tal cual |

Y hay **45 tests** (20 de `test_http_client.py`, 11 de mutations, 10 de queries, 4 del proxy), que pasan en algo más de un segundo sin red.

### 2.2 El arranque: dos clientes httpx con dos *timeouts*

```python
# gateway/app/main.py:14-27
@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.client = HttpBackendClient(settings.backend_url)
    app.state.proxy_client = httpx.AsyncClient(
        base_url=settings.backend_url, timeout=None
    )
    yield
    await app.state.client.close()
    await app.state.proxy_client.aclose()


async def get_context(request: Request) -> dict:
    return {"client": request.app.state.client}
```

Es el mismo patrón `lifespan` + `app.state` del backend (día 01), con dos clientes **de larga vida**. Un `httpx.AsyncClient` mantiene un *pool* de conexiones keep-alive. Crear uno por petición pagaría un *handshake* TCP cada vez.

Son dos clientes porque necesitan *timeouts* distintos:

- `HttpBackendClient` usa `timeout=30` (`http_client.py:14`). Una query que tarda más de 30 s es un fallo.
- `proxy_client` usa `timeout=None`. Un stream de `/preguntar` puede durar lo que tarde el LLM, y un *timeout* de lectura lo cortaría a mitad de la respuesta.

`get_context` es la **inyección de dependencias** de Strawberry. Cada resolver saca el cliente de `info.context["client"]` y nunca lo construye él. Por eso los tests pueden pasar `context_value={"client": fake_client}` y probar el esquema sin red.

### 2.3 El puerto: un `Protocol` y una excepción con código

```python
# gateway/app/clients/port.py
class BackendHttpError(Exception):
    def __init__(self, status: int, detail: str = "") -> None: ...

@runtime_checkable
class BackendClient(Protocol):
    async def obtener_ajustes(self) -> dict: ...
    async def obtener_documentos(self) -> list[dict]: ...
    # ... 13 métodos en total, uno por endpoint más close()
```

Es el mismo patrón puerto/adaptador que viste en `cola_port.py` (día 05): los resolvers dependen de la interfaz, `HttpBackendClient` es el adaptador real y `FakeBackendClient` (`tests/conftest.py`) es el doble de prueba. Ojo con un detalle: **ni `FakeBackendClient` ni `HttpBackendClient` heredan de `BackendClient`**. Un `Protocol` es tipado estructural: cumple quien tenga los métodos. Pero el gateway no ejecuta `mypy`, y ningún test hace `isinstance(..., BackendClient)`. Si añades un método al puerto y te olvidas del doble, **nada te avisa** hasta que un test llama al método. El `@runtime_checkable` está puesto y nadie lo usa. Hoy lo usarás.

### 2.4 De la query a REST: un resolver típico

```python
# gateway/app/schema/queries.py:36-40
@strawberry.field
async def documentos(self, info: Info) -> list[Documento]:
    client = info.context["client"]
    data = await client.obtener_documentos()
    return [Documento(**d) for d in data]
```

```python
# gateway/app/clients/http_client.py:25-30
async def obtener_documentos(self) -> list[dict]:
    resp = await self._client.get("/documentos")
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    return resp.json()["documentos"]
```

Aquí se ven tres trabajos del BFF:

1. **Traducir semántica.** El backend responde **404** cuando no hay documentos (`routers/documents.py:28`), una decisión discutible que viste el día 03. El gateway la convierte en `[]`, que es lo que una lista vacía debería ser.
2. **Aplanar.** El backend envuelve la lista en `{"documentos": [...]}` y el gateway la desenvuelve.
3. **Componer.** `salud` (`queries.py:70-75`) llama a `/health` y a `/health/qdrant` y devuelve un objeto anidado `Salud { backend, qdrant { ... } }`. Es la única query que agrega de verdad. Además hace las dos llamadas **en serie** (dos `await` seguidos), cuando podrían ir en paralelo con `asyncio.gather`.

### 2.5 Errores: de HTTP a `extensions.status`

```python
# gateway/app/clients/http_client.py:6-9
def _error_si_conflicto(resp: httpx.Response) -> None:
    if resp.status_code in (409, 429):
        detail = resp.json().get("detail", "")
        raise BackendHttpError(resp.status_code, detail)
```

```python
# gateway/app/schema/mutations.py:14-15
def _error_backend(e: BackendHttpError) -> GraphQLError:
    return GraphQLError(e.detail or str(e), extensions={"status": e.status})
```

Los errores **esperados** (404, 409, 429) se convierten en `BackendHttpError`. Las mutations los transforman en un `GraphQLError` con `extensions.status`, y el frontend lo recoge en `frontend/src/shared/api/graphql.ts`:

```ts
const [error] = respuesta.errors ?? [];
if (error) {
  throw new ErrorApi(error.message, 'http', error.extensions?.status);
}
```

Así un 429 del backend llega a la UI como `ErrorApi` con `estado: 429`, aunque el transporte haya sido un 200. El comentario de `graphql.ts` lo explica bien. Los errores **inesperados** (500, 422, backend caído) no pasan por este camino. Lo verás en §3.

### 2.6 Nombres: `auto_camel_case=False`

```python
# gateway/app/schema/__init__.py
schema = strawberry.Schema(query=Query, mutation=Mutation,
                           config=StrawberryConfig(auto_camel_case=False))
```

Por defecto Strawberry convierte `num_chunks` en `numChunks`, la convención de GraphQL. Aquí se desactiva: los campos se llaman igual en SQLite, en el JSON REST, en el SDL y en TypeScript (`num_chunks`, `actualizada_en`). Es la misma regla de nombres que fija el `README.md` raíz. Se gana *grep* de punta a punta y se pierde la convención que espera cualquiera que venga de GraphQL.

### 2.7 El *passthrough*: lo que no cabe en GraphQL

```python
# gateway/app/proxy.py:8-35, resumido
@router.post("/preguntar")
async def preguntar(request: Request):
    client: httpx.AsyncClient = request.app.state.proxy_client
    peticion = client.build_request("POST", "/preguntar", content=await request.body(), ...)
    resp = await client.send(peticion, stream=True)        # no lee el cuerpo todavía
    if resp.status_code != 200:
        await resp.aread()
        detail = resp.json().get("detail", resp.text)
        ...
        raise HTTPException(status_code=resp.status_code, detail=detail)

    async def generador():
        try:
            async for trozo in resp.aiter_bytes():          # byte a byte, sin parsear el SSE
                yield trozo
        finally:
            await resp.aclose()

    return StreamingResponse(generador(), media_type="text/event-stream")
```

Una respuesta GraphQL es **un** documento JSON, y un stream SSE es una secuencia abierta de eventos (día 09). GraphQL tiene *subscriptions* para eso, pero exigen WebSocket o *multipart incremental* tanto en el cliente como en el servidor. El backend ya emite SSE y el frontend ya lo sabe leer, así que el gateway **no interpreta nada**: copia bytes. El `finally` cierra la conexión con el backend aunque el navegador corte a mitad, y en nginx `proxy_buffering off` (`despliegue/nginx.conf:48`) evita que el stream se acumule en un búfer.

`/indexar-fichero` sigue la misma idea con la subida: `content=request.stream()` (`proxy.py:49`) reenvía el multipart a trozos, sin cargar el fichero entero en memoria. Además conserva el `Retry-After` de un 429 (`proxy.py:53-55`).

### 2.8 Lo que cambia por el camino: el contrato se vuelve más débil

Compara un tipo del backend con su espejo en el gateway:

| Campo | Backend (`schemas.py`) | Gateway (`types.py`) |
|---|---|---|
| `Documento.state` | `EstadoDocumento`, un `Literal` de 5 valores | `str` |
| `Mensaje.rol` | `Rol = Literal["user", "assistant"]` | `str` |
| `created_at`, `creada_en`, `actualizada_en` | `datetime.datetime` | `str` |
| `ajustes.modelos` | `list[str]` | `list[str]` |

GraphQL tiene `enum` y Strawberry tiene `strawberry.enum`, y también hay un escalar `DateTime`. No se usan, así que el frontend recibe cadenas sin significado y tiene que fiarse de que `state` será uno de los cinco valores.

---

## 3. Por qué se montó así (y qué no cuadra)

### Decisiones

- **Un BFF GraphQL para un único frontend.** El `README.md` lo justifica como "paso hacia microservicios" (tabla de *Roadmap*). El beneficio real hoy es que el frontend tiene **un único origen** (`VITE_API_URL=http://localhost:8080`, y `/api/` en nginx), recibe el esquema tipado y pide solo los campos que pinta. Con un solo backend y 14 endpoints, la agregación casi no se usa: solo `salud` compone. La alternativa honesta era REST directo desde el frontend, con un tipado generado desde el OpenAPI del backend: un servicio menos y un salto de red menos. El gateway compensa si crece el número de servicios detrás o si se le añade autenticación, y hoy no hay ninguna de las dos cosas.
- **Puerto `Protocol` + doble de prueba.** Los tests del esquema no necesitan ni backend ni red, y por eso los 45 tests tardan un segundo. El coste es mantener tres copias de cada método: el puerto, el adaptador y el doble.
- ***Passthrough* para SSE y multipart.** Es la decisión correcta: meter un stream en GraphQL obligaría a cambiar el protocolo en los dos extremos para no ganar nada.
- **Mapeo explícito, tipo a tipo.** Hay 12 tipos Strawberry escritos a mano que copian los `*Out` del backend. Era la opción más simple. La alternativa sería generar los tipos desde el OpenAPI, o usar la integración `strawberry.experimental.pydantic` compartiendo modelos. No se puede compartir código: son dos proyectos con sus propias dependencias.

### Cosas que no cuadran (comprobadas hoy contra `main`)

- 🔴 **Cualquier campo nuevo del backend rompe el gateway.** Los resolvers construyen los tipos con `Documento(**d)`, `Trabajo(**data)`, `Fuente(**f)`... y un `@strawberry.type` es un `dataclass`, que no admite argumentos de más. Lo he probado con un backend falso que añade `"nuevo": 1` a cada documento:

  ```text
  {"data":null,"errors":[{"message":"Documento.__init__() got an unexpected keyword argument 'nuevo'", "path":["documentos"]}]}
  ```

  Añadir un campo es el cambio **compatible** por excelencia en una API, y aquí tumba la lista de documentos de la UI. El acoplamiento va en el sentido equivocado: el gateway debería ignorar lo que no conoce. El arreglo es construir los tipos con los campos explícitos, como harás hoy en `estadisticas`, o filtrar las claves con `dataclasses.fields`.
- 🟠 **Los errores inesperados llegan sin código y con el texto de httpx.** Con el backend devolviendo 500 en `/ajustes`, o 422 en `/indexar`, el cliente recibe esto:

  ```text
  "message":"Server error '500 Internal Server Error' for url 'http://localhost:8001/ajustes'\nFor more information check: https://developer.mozilla.org/..."
  ```

  No trae `extensions.status`, y sí trae la URL interna del backend, que el BFF debería ocultar. Con el **backend caído** el mensaje es `"All connection attempts failed"`. Si sigues ese error por `graphql.ts` y `errores.ts`, el frontend lo convierte en `ErrorApi(tipo: 'http', estado: undefined)` y `mensajeDeError` enseña ese texto en inglés. El mensaje amable `MENSAJES.red` ("¿Está arrancado el backend?") **solo sale si el que está caído es el gateway**, nunca si es el backend. Le falta una extensión de Strawberry, o un `try` en el cliente, que traduzca `httpx.HTTPError` a `GraphQLError(..., extensions={"status": 502})`.
- 🟠 **`proxy.py` da 500 si el backend responde algo que no es JSON.** Si `/preguntar` devuelve un 502 en HTML (lo típico de un proxy intermedio), `resp.json()` (`proxy.py:25`) lanza `JSONDecodeError` antes de llegar a usar `resp.text`, que era justo la salida prevista. Con el backend caído pasa lo mismo: `ConnectError` sin capturar y **500**. Comprobado.
- 🟠 **Todos los campos raíz son no nulos.** Si en una misma petición pides `estadisticas` y `ajustes` y falla `ajustes`, pierdes también `estadisticas`: `data` se queda en `null`. El frontend no combina queries hoy, pero GraphQL te anima a hacerlo. Hoy lo provocarás a propósito.
- 🟡 **El healthcheck del gateway sigue roto en `main`.** `GET /graphql` sin `query` desde `urllib` da **400**, y el contenedor nunca llega a *healthy*, así que `frontend` (perfil `frontend`) no arranca. Lo vimos el día 02 y el arreglo sigue sin estar en `main`.
- 🟡 **`gateway/.env` sigue sin leerse.** `Settings` no declara `env_file` (día 02). Sigue igual.
- 🟡 **"Único punto de entrada" es una convención, no una barrera.** `docker-compose.yml` publica `api` en `8000:8000`, y el backend mantiene su propio `CORSMiddleware` para `localhost:3000/5173` (`backend/app/api/main.py:7-13`) aunque el frontend ya no le habla. Cualquiera en la máquina se salta el gateway. En local da igual. El día que el gateway tenga autenticación, no.
- 🟡 **CORS a fuego en el código.** `allow_origins` está escrito en `main.py:33` y no sale de `Settings`. Para desplegar en otro dominio hay que tocar código.
- 🟡 **GraphiQL e introspección siempre activos.** `__schema` responde a cualquiera y el IDE se sirve en producción. En un BFF interno es aceptable, pero debería ser una decisión explícita y no el valor por defecto.
- 🟡 **`ruff` no está fijado en el gateway.** El `README.md` dice "`ruff check` (backend y gateway) en verde", pero `ruff` no está en las dependencias de `gateway/pyproject.toml`. Con `uvx ruff` 0.16.9 salen **3 errores** en `main` (`I001` en dos tests y `SIM117` en `test_proxy.py`). Lo veremos el día 19, con el CI.
- ✅ **El campo `name` de `IndexRequest` no está en la mutation `indexar`, y está bien.** Lo comprobé porque parecía una pérdida, pero el backend lo declara `deprecated=True` e "IGNORADO" (`schemas.py:112-116`). El gateway hace bien en no exponerlo.

---

## 4. Ejercicio (≈40 min): `estadisticas` por GraphQL, de SQLite a `curl`

Hoy vas a recorrer el camino completo de una funcionalidad nueva por las tres capas que tocan el dato: **router del backend → puerto, adaptador y doble del gateway → tipo y resolver Strawberry**, con tests primero. Después lo probarás de punta a punta con los routers reales sobre una BD de demostración, sin Docker, sin modelos y sin Gemini, y romperás el contrato a propósito.

### Paso 1 — Rama y punto de partida (2 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-11 origin/main
(cd backend && uv sync && uv run pytest -q)     # 91 passed
(cd gateway && uv sync && uv run pytest -q)     # 45 passed
```

### Paso 2 — Un `GET /stats` mínimo en el backend (8 min)

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
```

Crea `backend/app/api/routers/stats.py`:

```python
from typing import Annotated, get_args

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.schemas import EstadisticasOut, EstadoDocumento
from app.db.models.conversation import Conversacion, Mensaje
from app.db.models.document import Document
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
    por_estado = {estado: 0 for estado in get_args(EstadoDocumento)}
    por_estado.update(
        dict(db.execute(select(Document.state, func.count()).group_by(Document.state)).all())
    )
    fragmentos = db.scalar(
        select(func.coalesce(func.sum(Document.num_chunks), 0))
        .where(Document.state == "indexado")
    )
    return {
        "documentos": sum(por_estado.values()),
        "documentos_por_estado": por_estado,
        "fragmentos_indexados": fragmentos,
        "conversaciones": db.scalar(select(func.count()).select_from(Conversacion)),
        "mensajes": db.scalar(select(func.count()).select_from(Mensaje)),
    }
```

En `backend/app/api/main.py`, cambia la línea 5 y añade una línea al final:

```python
from app.api.routers import conversations, documents, health, indexation, jobs, query, stats
# ...
app.include_router(stats.router)
```

Comprueba que no has roto nada:

```bash
cd backend
uv run pytest -q                                              # 91 passed
uvx ruff check app/api/routers/stats.py app/api/schemas.py    # All checks passed!
cd ..
```

Las consultas están en el router y no en `db/crud/`, como pedía el día 04. Es un atajo consciente para hoy. Si te sobra tiempo, muévelas a `app/db/crud/stats.py` como allí.

### Paso 3 — Los tests del gateway primero, en rojo (5 min)

Crea `gateway/tests/test_estadisticas.py`:

```python
"""Query 'estadisticas': del GET /stats del backend a GraphQL."""

import httpx

from app.clients.http_client import HttpBackendClient
from app.clients.port import BackendClient
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


async def test_estadisticas_cuenta_lo_que_tiene_el_backend(fake_client):
    result = await schema.execute(CONSULTA, context_value={"client": fake_client})

    assert result.errors is None
    datos = result.data["estadisticas"]
    assert datos["documentos"] == 1
    assert datos["fragmentos_indexados"] == 12
    assert datos["conversaciones"] == 1
    assert datos["mensajes"] == 0


async def test_estadisticas_por_estado_es_una_lista_con_los_cinco(fake_client):
    result = await schema.execute(CONSULTA, context_value={"client": fake_client})

    assert result.errors is None
    por_estado = {
        fila["estado"]: fila["cantidad"]
        for fila in result.data["estadisticas"]["documentos_por_estado"]
    }
    assert por_estado == {
        "en-cola": 0, "indexando": 0, "pendiente": 0, "indexado": 1, "error": 0,
    }


async def test_estadisticas_error_del_backend_llega_como_error_graphql(fake_client):
    async def roto() -> dict:
        raise httpx.ConnectError("backend caido")

    fake_client.obtener_estadisticas = roto
    result = await schema.execute(CONSULTA, context_value={"client": fake_client})

    assert result.data is None
    assert result.errors[0].message == "backend caido"
    assert result.errors[0].path == ["estadisticas"]


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


def test_los_dos_clientes_cumplen_el_protocolo():
    assert isinstance(FakeBackendClient(), BackendClient)
    assert isinstance(HttpBackendClient("http://test"), BackendClient)
```

No hace falta `@pytest.mark.asyncio`: `pyproject.toml` declara `asyncio_mode = "auto"`. Los decoradores que llevan los tests existentes sobran.

```bash
cd gateway
uv run pytest -q tests/test_estadisticas.py      # esperado: 4 failed, 1 passed
```

Pega en la entrega **el motivo** de cada fallo. Fíjate en que `test_los_dos_clientes_cumplen_el_protocolo` **pasa** todavía. ¿Por qué? (pregunta 6).

### Paso 4 — Puerto, adaptador, doble, tipo y resolver (10 min)

**4a.** En `app/clients/port.py`, dentro de `BackendClient`, justo antes de `async def salud`:

```python
    async def obtener_estadisticas(self) -> dict: ...
```

Vuelve a ejecutar los tests. Ahora **sí** falla el del protocolo: el puerto pide un método que ninguno de los dos clientes tiene. Esa es la red de seguridad que faltaba en el repo.

**4b.** En `app/clients/http_client.py`, antes del bloque `# ── salud`:

```python
    # ── estadisticas ─────────────────────────────────────────────────

    async def obtener_estadisticas(self) -> dict:
        resp = await self._client.get("/stats")
        resp.raise_for_status()
        return resp.json()
```

**4c.** En `tests/conftest.py`, dentro de `FakeBackendClient`, antes de `# ── salud`:

```python
    # ── estadisticas ─────────────────────────────────────────────────

    async def obtener_estadisticas(self) -> dict:
        por_estado = dict.fromkeys(
            ("en-cola", "indexando", "pendiente", "indexado", "error"), 0
        )
        for d in self.documentos:
            por_estado[d["state"]] += 1
        return {
            "documentos": len(self.documentos),
            "documentos_por_estado": por_estado,
            "fragmentos_indexados": sum(
                d["num_chunks"] for d in self.documentos if d["state"] == "indexado"
            ),
            "conversaciones": len(self.conversaciones),
            "mensajes": 0,
        }
```

El doble **calcula** a partir de sus propios datos en vez de devolver una constante. Así, si un test borra un documento del doble, las estadísticas cambian con coherencia.

**4d.** Al final de `app/schema/types.py`:

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

GraphQL no tiene diccionarios, así que el `dict[EstadoDocumento, int]` del backend se convierte en **una lista de pares**. Es la decisión de la pregunta 2.

**4e.** En `app/schema/queries.py`, añade `Estadisticas` y `EstadoCantidad` al `import` de `app.schema.types` (en ese orden, justo después de `Documento`, para que `ruff` no proteste por el `I001`). Después, al final de la clase `Query`:

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

Con **campos explícitos** y no con `Estadisticas(**data)`: si mañana el backend añade un campo a `/stats`, esta query no se rompe. Es el arreglo del primer 🔴 de §3, aplicado a tu código.

```bash
uv run pytest -q                                   # esperado: 50 passed
uvx ruff check app tests/test_estadisticas.py tests/conftest.py   # All checks passed!
uv run python -c "from app.schema import schema; print(schema.as_str())" \
  | grep -A7 -E "^type (Estadisticas|EstadoCantidad|Query)"
```

En el SDL debe aparecer `estadisticas: Estadisticas!` dentro de `type Query` y `documentos_por_estado: [EstadoCantidad!]!`. Pégalo en la entrega.

### Paso 5 — De punta a punta: SQLite → backend → gateway → `curl` (10 min)

Los scripts van **fuera del repo**, en `/tmp/agent4u-gw`:

```bash
mkdir -p /tmp/agent4u-gw
cat > /tmp/agent4u-gw/sembrar.py <<'EOF'
"""Rellena una BD de usar y tirar con el CRUD REAL de AGENT4U."""
import uuid

from app.db.crud import conversation as cc
from app.db.crud import document as dc
from app.db.session import SessionLocal, crear_esquema

crear_esquema()
with SessionLocal() as s:
    cap = cc.crear_conversacion(s, titulo="¿Qué es el teorema CAP?", usuario="local")
    cc.anadir_mensaje(s, cap.id, "user", "¿Qué es el teorema CAP?")
    cc.anadir_mensaje(s, cap.id, "assistant", "Que no puedes tenerlo todo.")

    a = dc.crear_documento_encolado(s, "/uploads/cap.pdf", "cap.pdf", "pdf", 120_000, str(uuid.uuid4()))
    dc.marcar_indexado(s, a, 42)
    b = dc.crear_documento_encolado(s, "/uploads/raft.pdf", "raft.pdf", "pdf", 80_000, str(uuid.uuid4()))
    dc.marcar_error(s, b, "docling: PDF cifrado")
    dc.crear_documento_encolado(s, "/uploads/paxos.pdf", "paxos.pdf", "pdf", 50_000, "trabajo-de-prueba")
    print(f"sembrada · conversación CAP = {cap.id}")
EOF

cat > /tmp/agent4u-gw/servidor.py <<'EOF'
"""Los routers REALES de stats, documentos y conversaciones, sin modelos ni Qdrant."""
from fastapi import FastAPI

from app.api.routers import conversations, documents, stats

app = FastAPI()
app.include_router(stats.router)
app.include_router(documents.router)
app.include_router(conversations.router)
EOF
```

**Terminal 1**, el backend de demostración en el puerto 8001:

```bash
cd backend
export APP_DB_URL=sqlite:////tmp/agent4u-gw/demo.db
rm -f /tmp/agent4u-gw/demo.db*
PYTHONPATH=. uv run python /tmp/agent4u-gw/sembrar.py
PYTHONPATH=/tmp/agent4u-gw:. uv run uvicorn servidor:app --port 8001
```

**Terminal 2**, el gateway real apuntando a ese backend. Recuerda que el `.env` del gateway no se lee, así que la variable va en línea:

```bash
cd gateway
GATEWAY_BACKEND_URL=http://localhost:8001 uv run uvicorn app.main:app --port 8080
```

**Terminal 3**, las pruebas:

```bash
curl -s localhost:8001/stats | python3 -m json.tool

g() { curl -s localhost:8080/graphql -H 'content-type: application/json' -d "$1" | python3 -m json.tool; }

g '{"query":"{ estadisticas { documentos fragmentos_indexados conversaciones mensajes documentos_por_estado { estado cantidad } } }"}'
g '{"query":"{ estadisticas { documentos } documentos { name state } }"}'
g '{"query":"{ estadisticas { documentos_por_estado } }"}'
```

Lo que debes ver:

- REST: `documentos: 3`, `fragmentos_indexados: 42`, `mensajes: 2` y el diccionario con `en-cola: 1`, `indexado: 1`, `error: 1`.
- La primera query: lo mismo, pero `documentos_por_estado` como **lista de cinco objetos** `{estado, cantidad}`.
- La segunda: **dos recursos en una sola petición**. Es la agregación del BFF.
- La tercera: un error de **validación** (`must have a selection of subfields`) que nunca llega al backend. Strawberry lo rechaza contra el esquema antes de ejecutar ningún resolver.

### Paso 6 — Rompe el contrato a propósito (3 min)

Con las tres terminales todavía abiertas:

```bash
# 6a. Un campo no nulo que falla arrastra a los demás.
#     El backend de demo no monta /ajustes, así que devuelve 404.
g '{"query":"{ estadisticas { documentos } ajustes { modelos } }"}'
# Y con un campo raíz que admite null:
g '{"query":"{ estadisticas { documentos } conversacion(id: 1) { titulo } }"}'

# 6b. Para el backend (Ctrl+C en la terminal 1) y repite:
g '{"query":"{ estadisticas { documentos } }"}'
curl -s -i localhost:8080/preguntar -H 'content-type: application/json' -d '{}' | head -1

# 6c. Un campo de más rompe un tipo construido con **d:
cd gateway
uv run python -c "
from app.schema.types import Documento
Documento(id=1, origin='o', name='n', type='pdf', size=None, created_at='x',
          state='indexado', num_chunks=1, error_message=None, nuevo=1)"
```

Esperado: en 6a, `"data": null` con el error de `ajustes` en la primera, y `estadisticas` intacta más `conversacion: null` en la segunda. En 6b, `"All connection attempts failed"` sin `extensions` y un `HTTP/1.1 500` en el *passthrough*. En 6c, `TypeError: ... unexpected keyword argument 'nuevo'`.

### Paso 7 — Subir el código (2 min)

```bash
cd ~/ruta/AGENT4U
git add backend/app/api/schemas.py backend/app/api/routers/stats.py backend/app/api/main.py \
        gateway/app/clients/port.py gateway/app/clients/http_client.py \
        gateway/app/schema/types.py gateway/app/schema/queries.py \
        gateway/tests/conftest.py gateway/tests/test_estadisticas.py
git status --short          # no debe quedar nada de /tmp ni ficheros sueltos
git commit -m "feat: GET /stats en el backend y query estadisticas en el gateway"
git push -u origin ejercicio/dia-11
```

### Preguntas (responde con tus palabras en la entrega)

1. ¿Qué es un BFF? Di **dos** cosas que el gateway le resuelve hoy a este frontend y **una** que dice resolver y no resuelve (pista: `docker-compose.yml` y el CORS del backend).
2. `documentos_por_estado` es un `dict` en el backend y una lista de `{estado, cantidad}` en GraphQL. Compara tres alternativas: la lista de pares, un escalar `JSON` y un tipo con cinco campos fijos (`en_cola`, `indexando`...). ¿Qué gana y qué pierde cada una en tipado, en evolución (un sexto estado) y en comodidad para el frontend? ¿Cuál elegirías tú?
3. Explica la salida de 6a: ¿por qué `estadisticas`, que funcionó, desaparece en la primera query y no en la segunda? ¿Qué cambiarías en el esquema, y qué coste tendría para el código TypeScript que lo consume?
4. Con el backend caído (6b), ¿qué texto vería el usuario en la UI? Sigue el camino por `graphql.ts` → `ErrorApi` → `mensajeDeError` y explica por qué no aparece `MENSAJES.red`. ¿En qué capa lo arreglarías y con qué `extensions.status`?
5. ¿Por qué `/preguntar` no es una query ni una *subscription* de GraphQL? ¿Qué tendría que cambiar en el frontend, el gateway y el backend para que lo fuera, y qué se ganaría?
6. ¿Por qué `test_los_dos_clientes_cumplen_el_protocolo` pasaba en el Paso 3 y falló tras el 4a? ¿Qué comprueba exactamente `isinstance` con un `Protocol` `@runtime_checkable`, y qué **no** comprueba? (Prueba a cambiar la firma del método en el doble a `def obtener_estadisticas(self, x)` y ejecuta el test.)
7. En `Query.estadisticas` construyes el tipo con campos explícitos y no con `**data`. Elige otro resolver del repo que use `**` y explica qué cambio concreto del backend lo rompería en producción.

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-11` creada desde `main` y subida, con un único commit que solo toca los 9 ficheros del Paso 7.
- [ ] `cd backend && uv run pytest -q` → **91 passed**.
- [ ] `cd gateway && uv run pytest -q` → **50 passed**.
- [ ] `uvx ruff check` limpio en los ficheros que has creado o tocado.
- [ ] Salida del Paso 3 pegada (4 failed, 1 passed) con el motivo de cada fallo.
- [ ] SDL del Paso 4 pegado, con `estadisticas: Estadisticas!` en `Query`.
- [ ] Las tres salidas del Paso 5 pegadas: REST y las dos queries con 3 documentos, 42 fragmentos y 2 mensajes, y el error de validación.
- [ ] Las tres pruebas del Paso 6 pegadas.
- [ ] Las 7 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

Entrega antes de las **8:30 del miércoles 11-nov**:

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-11.md
# ...rellena dia-11.md: salidas de pytest, SDL, curl, experimentos, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-11.md
git commit -m "entrega día 11" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code y te revisa la entrega y la rama al momento.

---

## 5. Para profundizar (opcional)

- Strawberry, tipos de esquema y nulabilidad: <https://strawberry.rocks/docs/types/schema>. Para la pregunta 4, mira también *Extensions*: <https://strawberry.rocks/docs/guides/custom-extensions>.
- La especificación de GraphQL sobre cómo se propagan los errores de campos no nulos: <https://spec.graphql.org/October2021/#sec-Handling-Field-Errors>.

---

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la sección *Gateway* debería cubrir:

- Qué es y qué no es: un BFF sin lógica de negocio que traduce GraphQL a REST, el único origen del frontend (por convención: el backend sigue expuesto en `8000`).
- Las piezas: `lifespan` con dos clientes httpx y por qué tienen *timeouts* distintos (30 s frente a ninguno), `get_context` como inyección de dependencias, y el puerto `BackendClient` con su adaptador y su doble.
- El mapa de las 14 operaciones REST: 6 queries (con `salud` componiendo dos), 5 mutations y 2 *passthrough*, y por qué SSE y multipart no pasan por GraphQL.
- El modelo de errores: 404, 409 y 429 → `extensions.status`. Y el hueco: 5xx, 422 y backend caído llegan sin código y con texto de httpx.
- Lo que se pierde por el camino: `Literal` → `str`, `datetime` → `str`, `dict` → lista de pares. Y el acoplamiento frágil de `Tipo(**dict)`.
- Tu `estadisticas` como ejemplo de cómo añadir un campo a las tres capas, con tests primero.

**El miércoles 11-nov (día 12):** cruzamos al frontend. Herramientas y estructura: qué hace Vite en desarrollo y qué hace al construir, por qué `VITE_API_URL` se fija **al construir** y no al ejecutar (ya lo verás en `cliente.ts`), cómo se reparten `app/`, `features/`, `shared/` y `sitio/`, el alias `@/` de `tsconfig`, el `Dockerfile` multietapa con nginx y su `location /api/` que quita el prefijo, y qué vigila `knip`. El ejercicio: arrancar el frontend contra el gateway de hoy y dibujar el mapa de rutas y carpetas.
