# Píldora 03 — Contratos de la API con Pydantic

**Sábado 24-oct-2026 · sesión larga: 30 min de lectura + 2-3 h de ejercicio**

## 0. Crítica de la entrega del día 02

No hay entrega del día 02: en `origin/aprendizaje` no existe `entregas/dia-02.md` y en el remoto no hay rama `ejercicio/dia-02`. Sin nota, y seguimos.

Dos cosas siguen pendientes y te conviene no dejarlas morir:

- **El bug de la clave de Gemini sigue en `main`.** `grep -rn gemini_api_key backend/app` sigue devolviendo solo la declaración en `config.py`, así que en Docker `/preguntar` falla por autenticación. Es el Paso 4 del día 02 y se hace en 15 minutos. Si lo entregas tarde, te lo critico en la píldora del lunes.
- **Tu arreglo del healthcheck del gateway sigue en la rama equivocada.** `git diff origin/main origin/aprendizaje -- docker-compose.yml` sigue mostrando tus dos cambios. Los comandos para llevarlo a `fix/healthchecks` y abrir la PR están en la píldora 02, sección 0.

Hoy toca una sesión larga, y el ejercicio está pensado para que la parte de predicción **no se pueda hacer copiando de un chat**: primero escribes y subes lo que crees que va a salir, y después lo ejecutas. El historial de git es la prueba de que la predicción fue antes.

---

## 1. Concepto clave: el contrato de una API

Una API HTTP es un **contrato**: qué forma tiene lo que entra, qué forma tiene lo que sale y qué código HTTP acompaña a cada caso. Quien llama (el gateway, el frontend, un `curl`) solo puede fiarse de ese contrato, no de tu código. Un contrato tiene tres partes que se pueden separar sin querer:

1. **Lo que el código hace de verdad.**
2. **Lo que el código valida** (lo que se rechaza con 422 antes de llegar a tu función).
3. **Lo que la documentación promete** (OpenAPI en `/docs`, el README, los comentarios).

La gracia de FastAPI con Pydantic es que, bien usado, **las tres salen de la misma clase**. Así funciona:

### 1.1 Entrada: el cuerpo se valida antes de tu función

Si un parámetro del endpoint es un `BaseModel`, FastAPI lee el JSON del cuerpo y llama a `Modelo.model_validate(json)`. Pydantic v2 hace tres cosas:

- **Coerción** (modo *lax*, el de defecto): `"20480"` en un campo `int` se convierte en `20480`. `"abc"` no se puede convertir y falla.
- **Restricciones**: `Field(ge=1)`, `min_length`, `pattern`, `Literal[...]`.
- **Validadores propios**: `@field_validator`, con `mode="before"` (antes de la coerción, recibe el valor crudo) o `"after"` (por defecto, recibe el valor ya convertido).

Si algo falla, **tu función ni se ejecuta**. FastAPI responde `422 Unprocessable Entity` con un cuerpo fijo:

```json
{"detail": [{"type": "missing", "loc": ["body", "query"], "msg": "Field required", "input": {}}]}
```

Fíjate: `detail` es una **lista** de errores, cada uno con `loc` (dónde), `type` (qué regla) y `msg`. Y los campos que no están declarados en el modelo **se ignoran sin avisar**: el defecto de Pydantic es `extra="ignore"`.

### 1.2 Salida: `response_model` filtra y valida

Cuando declaras `@router.get(..., response_model=DocumentoOut)`, FastAPI coge lo que devuelve tu función (un `dict`, un objeto ORM o un modelo) y lo pasa por `DocumentoOut` **antes** de serializarlo:

- **Filtra**: los campos que no están en el modelo no salen. Si tu objeto ORM tiene `hash_content`, no sale.
- **Valida**: si falta un campo obligatorio o un `Literal` no cuadra, salta un error **en el servidor** (`ResponseValidationError`) y el cliente recibe un 500. Es un fallo tuyo, no del cliente.
- Con `model_config = ConfigDict(from_attributes=True)`, Pydantic lee **atributos** (`doc.name`) además de claves de diccionario. Es lo que permite devolver directamente una fila de SQLAlchemy.

### 1.3 Documentación: lo mismo, en OpenAPI

FastAPI genera `/openapi.json` a partir de los modelos de entrada, de `response_model` y del parámetro `responses={404: {"model": ErrorOut}}`. Ojo con esto último: **`responses=` es solo documentación**. No valida nada ni obliga a nada; si el endpoint devuelve otra cosa con 404, OpenAPI miente y nadie se entera.

### 1.4 Uniones discriminadas

Para un campo que puede ser "uno de varios modelos", Pydantic permite marcar un **discriminador**: un campo `Literal` que dice cuál es.

```python
Evento = Annotated[EventoA | EventoB, Field(discriminator="tipo")]
```

Al validar, Pydantic mira `tipo` y va directo al modelo correcto. Es más rápido que probar uno a uno y, sobre todo, da errores claros ("el tag `x` no es ninguno de los esperados").

---

## 2. Cómo está en AGENT4U

Versiones de `backend/uv.lock`: **FastAPI 0.139.2** y **Pydantic 2.13.4**.

### 2.1 `backend/app/api/schemas.py` (505 líneas)

Es el contrato de toda la API: **27 clases** agrupadas por secciones (errores, peticiones, documentos, cola de trabajos, salud, conversaciones y eventos SSE). Casi todos los campos llevan `description` y `examples`, que es lo que ves en `/docs`. Lo más interesante:

**Alias de dominio (líneas 11-12).** `Rol` y `EstadoDocumento` son `Literal`, y se reutilizan en varios modelos. Si mañana añades un estado, se cambia en un sitio.

```python
Rol = Literal["user", "assistant"]
EstadoDocumento = Literal["en-cola", "indexando", "pendiente", "indexado", "error"]
```

**El error único (línea 19).** `ErrorOut` tiene un solo campo, `detail: str`. Es la forma que tiene `HTTPException(status_code=..., detail="texto")`. Todos los `responses={404: {"model": ErrorOut}}` de los routers apuntan aquí.

**`QueryRequest` (líneas 30-59)**, el cuerpo de `/preguntar`:

```python
class QueryRequest(BaseModel):
    query: str
    conversacion_id: int | None = None
    max_fragmentos: int | None = Field(default=None, ge=1, ...)
    modelo: str | None = Field(default=None, ...)

    @field_validator("conversacion_id", mode="before")
    @classmethod
    def _vacio_a_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v
```

El validador es `mode="before"` por una razón concreta: `""` no se puede convertir a `int`, así que si el validador fuera `after`, la coerción fallaría antes de que él llegara a ver el valor. Fíjate también en lo que **no** valida: `query` no tiene `min_length`, así que `{"query": ""}` es válido (lo he comprobado: `QueryRequest.model_validate({"query": ""})` no falla).

**`IndexRequest` (líneas 86-120).** `file_path` y `type` con `min_length=1`, `size` con `ge=0`. El campo `name` está marcado `deprecated=True` y su descripción dice "IGNORADO": se acepta para no romper clientes viejos, pero el nombre se deriva siempre de la ruta. `IndexUrlRequest` (línea 123) valida la URL solo con `pattern=r"^https?://"`.

**`DocumentoOut` (líneas 151-182).** Su docstring lo dice: *"se omiten a propósito 'hash_content' y 'user'"*. La tabla `documents` (`db/models/document.py`) tiene 12 columnas y el modelo expone 9; además de esas dos, tampoco sale `job_id`. Lleva `from_attributes=True` porque `GET /documentos` devuelve filas ORM tal cual.

**Herencia para respuestas que amplían otras.** `FicheroEncoladoOut(TrabajoEncoladoOut)` añade `ruta`; `ConversacionDetalleOut(ConversacionResumenOut)` añade `mensajes`.

**`RenombrarConversacionIn` (línea 430)** combina restricción y validador: `min_length=1, max_length=256` (el límite de la columna) y un `field_validator` *after* que recorta espacios y rechaza el título vacío. El orden importa: `"   "` tiene 3 caracteres y pasa `min_length=1`, así que es el validador el que lo para.

**Los eventos SSE (líneas 458-505).** Cinco modelos (`EventoInicio`, `EventoFuentes`, `EventoTexto`, `EventoError` y `EventoFin`) unidos en `EventoSSE` con `discriminator="tipo"`, y envueltos en `EventoStream(RootModel[EventoSSE])`. **Este modelo no se usa para validar nada en ejecución**: solo aparece en `query.py:68`, dentro de `responses=` para la documentación. Los eventos reales los fabrica `traductor_evento` en `rag/streaming.py:8` con `json.dumps` a pelo:

```python
def traductor_evento (tipo: str, datos: dict) -> str:
    return f"data: {json.dumps({'tipo': tipo, **datos}, ensure_ascii=False)}\n\n"
```

Recuerda esto, porque es el bug principal de hoy.

### 2.2 Cómo lo usan los routers

**13 de los 14 endpoints** declaran `response_model`. El que no es `POST /preguntar`, que usa `response_class=EventStreamResponse` (`query.py:12-16`), una subclase de `StreamingResponse` que solo existe para que OpenAPI documente `text/event-stream`. El endpoint, en realidad, devuelve un `StreamingResponse` normal (`query.py:120`).

Los routers devuelven tres tipos de cosas, y `response_model` las trata igual:

- **Diccionarios**: `return {"status": "eliminada", "id": conversacion_id}` (`conversations.py:45`).
- **Filas ORM**: `return conv` (`conversations.py:60`), gracias a `from_attributes`.
- **El modelo construido a mano**: `TrabajoEstadoOut(job_id=doc.job_id, status=doc.state, ...)` (`jobs.py:26`). Es necesario porque la columna se llama `state` y el campo `status`.

### 2.3 `backend/app/core/exceptions.py`: excepciones de dominio

Cuatro clases, todas `Exception` con atributos (`origen`, `causa`, `conversacion_id`, ...). La idea es que **los servicios no sepan nada de HTTP**: `query_service.py:16` lanza `ConversacionNoEncontrada`, y es el router (`query.py:117-118`) quien la traduce a 404. Lo mismo con `DocumentoYaExiste` → 409 en `indexation.py`.

No hay ningún `@app.exception_handler` registrado: cada router traduce sus excepciones con `try/except` y `HTTPException`. Lo comento en la sección 3.

### 2.4 Tres copias del mismo contrato

El contrato existe **tres veces, escrito a mano**:

| Dónde | Qué es |
|---|---|
| `backend/app/api/schemas.py` | Pydantic: valida la entrada y filtra la salida. |
| `gateway/app/schema/types.py` | Tipos de Strawberry para GraphQL. Por ejemplo, `Documento.state: str` (pierde el `Literal`). |
| `frontend/src/shared/api/types.ts` | Tipos TypeScript. Su cabecera dice *"Espejo de backend/app/api/schemas.py"*. |

No hay generación de código desde OpenAPI (`grep openapi frontend/package.json` no devuelve nada). Cada cambio de contrato hay que hacerlo en tres sitios y a mano. Y ya hay una copia desincronizada.

---

## 3. Por qué se montó así (y qué no cuadra)

### Decisiones

1. **Un único fichero `schemas.py`, con DTO separados de los modelos ORM.** La alternativa (devolver el ORM tal cual, o usar SQLModel, que fusiona ORM y DTO) es más corta, pero acopla la API a la tabla: cada columna nueva saldría al exterior. Aquí la tabla tiene `hash_content`, `user` y `job_id`, y no salen porque `DocumentoOut` no los declara. *Coste:* una clase más por recurso y un `from_attributes` que hay que acordarse de poner.

2. **Descripciones y ejemplos en cada campo.** `/docs` es la documentación de la API, y está pensada para quien la consume. Muchas descripciones avisan de trampas reales ("OJO: si no hay ningún documento responde 404"). *Coste:* la documentación vive en strings que **nadie comprueba**, y se pudren (lo vemos abajo).

3. **Excepciones de dominio traducidas en el router.** Los servicios se pueden probar sin FastAPI (`tests/integration/test_query_service.py:61` hace `pytest.raises(ConversacionNoEncontrada)`). La alternativa idiomática es registrar un `@app.exception_handler(DocumentoYaExiste)` en `main.py` una vez, en lugar de repetir el `try/except → HTTPException(409)` en los tres endpoints de indexación. *Coste del enfoque actual:* repetición, y el riesgo de que un endpoint nuevo olvide la traducción y responda 500.

4. **Errores de negocio con 200 y un campo `status`.** `/health/qdrant` y `DELETE /documentos/{documento}` responden 200 aunque fallen, y hay que leer `status`. Para la sonda tiene sentido (lo vimos el día 01: liveness frente a dependencias). Para el borrado es más discutible: un fallo de Qdrant al borrar es un fallo de la operación, y lo habitual sería un 502 o 503.

5. **Uniones discriminadas para el stream.** Es la forma correcta de describir "un evento de N tipos" en OpenAPI: `/openapi.json` genera un `discriminator` con su `mapping`, y una herramienta de generación de clientes sabría crear un tipo por evento.

### Cosas que no cuadran (todas comprobadas hoy contra `main`)

- 🔴 **El contrato SSE no incluye el evento `paso`, y el backend lo emite en cada pregunta.** `query_service.py:85` hace `yield traductor_evento("paso", {"nodo": ..., "ms": ..., **datos_del_paso(...)})` una vez por nodo del grafo. Pero `EventoSSE` solo conoce 5 tipos, y la descripción de `/preguntar` (`query.py:59`) promete el orden "`inicio`, `fuentes`, N x `texto`" sin pasos. El frontend sí lo conoce (`frontend/src/shared/api/preguntar.ts:17` y `types.ts:115`), y su test (`preguntar.test.ts:38`) cuenta que ya hubo un bug por esto mismo: *"al añadir `paso` en el backend se olvidó la lista blanca del parser"*. Lo he comprobado: validar los eventos reales contra `EventoSSE` falla con `Input tag 'paso' found using 'tipo' does not match any of the expected tags`. **Causa raíz:** los eventos se serializan con `json.dumps`, no con los modelos, así que nada obliga a que coincidan. Lo arreglas en el ejercicio.

- 🔴 **Subir un fichero con un nombre ya indexado pisa el fichero en disco y después responde 409.** En `indexar_fichero` (`indexation.py:148-205`), el `os.replace(parcial, destino)` de la línea 179 se ejecuta **antes** de comprobar si el documento existe, que se comprueba en `_encolar_trabajo`. Lo he reproducido: subo `a.txt` con "VERSION 1" (202), subo otro `a.txt` con "VERSION 2 distinta" (409), y en disco queda "VERSION 2 distinta". Los vectores de Qdrant son del contenido viejo y el fichero ya es el nuevo. El 409 tampoco borra el fichero (solo se borra en el camino del 429, líneas 193-195). Lo retomamos el día 05.

- 🟠 **El 422 tiene dos formas distintas.** El de Pydantic trae `detail` como **lista** de objetos; los que lanza el router a mano (`query.py:93-102`, "Modelo no permitido" y "max_fragmentos no puede pasar de 20") traen `detail` como **string**. OpenAPI solo documenta el primero (`HTTPValidationError`). El frontend (`cliente.ts:130-148`) solo sabe leer el string, así que con `max_fragmentos: 0` el usuario ve el mensaje genérico, y con `999` ve el mensaje bueno. Es el mismo error de usuario ("te has pasado de rango") por los dos extremos, con dos experiencias distintas.

- 🟠 **`_encolar_trabajo` convierte cualquier fallo de la base de datos en 409** (`indexation.py:64-66`): `except Exception: raise DocumentoYaExiste(file_path)`. Un disco lleno o un `database is locked` de SQLite llegarían al cliente como "El origen ya está indexado". Además el mensaje dice "ya está indexado" cuando el documento puede estar todavía `en-cola`.

- 🟠 **El README documenta una API que ya no existe.** La sección *Uso de la API* dice que "hay dos endpoints" (hay 14), manda a `/indexar` un cuerpo con `ruta_archivo` y `nombre` (los campos son `file_path` y `type`; lo he probado y responde 422 con dos `missing`), promete `{"status": "indexado"}` (es un 202 con `job_id`) y dice que `/preguntar` devuelve un JSON con `respuesta` (es un stream SSE). Lo arreglas en el ejercicio.

- 🟡 **Código muerto en el contrato.** `IndexacionOut` y `FicheroSubidoOut` (`schemas.py:212-236`) son las respuestas de **antes** de la cola, cuando `/indexar` era síncrono. `IndexacionSaturada` (`exceptions.py:19-34`) tampoco la lanza nadie: el 429 se construye directamente en `_comprobar_cupo`, y su docstring habla del threadpool, que era el riesgo de antes de Redis. `grep -rn` de los tres nombres en todo el repo solo devuelve sus definiciones.

- 🟡 **Inconsistencias de forma:**
  - `GET /documentos` responde **404** si no hay documentos, mientras que `GET /conversaciones` responde `[]`. El gateway tiene que tapar esa diferencia (`gateway/app/clients/http_client.py:27`: `if resp.status_code == 404: return []`). Una colección vacía no es un recurso inexistente; lo correcto es `200 []`.
  - `ConversacionNoEncontrada.__init__(self, conversacion_id: str)` recibe en realidad un `int`.
  - `DocumentoOut.size` y `error_message` son `int | None` **sin** `default`, así que en OpenAPI aparecen como obligatorios (pueden valer `null`, pero tienen que venir). Para un modelo de salida es correcto; en uno de entrada sería una trampa.

- 🟡 **Riesgos de seguridad del contrato de entrada** (los retomamos el día 21):
  - `IndexRequest.file_path` acepta **cualquier ruta del servidor**: el worker intentará indexar `/etc/passwd` si se lo pides.
  - `IndexUrlRequest.url` solo exige `^https?://`, así que `http://qdrant:6333/collections` o `http://169.254.169.254/` son válidas. Eso es un SSRF de manual.
  - Los campos desconocidos se ignoran (`extra="ignore"`), así que un cliente con un typo (`max_fragmento`) no recibe ningún error: simplemente se usa el valor por defecto.

---

## 4. Ejercicio (sesión larga, 2-3 h)

**Rama de código:** `ejercicio/dia-03`, creada desde `main`.
**Entrega:** `docs/aprendizaje/entregas/dia-03.md`, en la rama `aprendizaje`, **antes de las 8:30 del lunes 26-oct**.

El ejercicio tiene dos partes:
- **A (≈1 h):** predecir el contrato y comprobarlo.
- **B (≈1,5 h):** arreglar las desincronizaciones con un test que lo vigile.

### Parte A — Predecir antes de llamar

#### Paso 1 — Prepara la entrega y escribe tus predicciones (25 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-03.md
```

Abre `dia-03.md` y crea una sección `## Predicciones`. Para cada uno de los 9 casos de abajo, escribe **el código HTTP y el JSON exacto** que crees que devolverá la API. Para eso, lee **solo el código**: `schemas.py`, los routers y `exceptions.py`. No ejecutes nada todavía.

1. `GET /health/qdrant` con Qdrant caído.
2. `POST /indexar` con el cuerpo que da el README: `{"ruta_archivo": "/ruta/absoluta/al/documento.pdf", "nombre": "manual-usuario-v2"}`.
3. `GET /documentos` con la tabla vacía.
4. `POST /preguntar` con `{"query": "hola", "max_fragmentos": 0}`.
5. `POST /preguntar` con `{"query": "hola", "max_fragmentos": 999}`.
6. `POST /indexar` con `{"file_path": "/docs/manual.pdf", "type": "pdf", "size": "20480", "name": "otro.pdf", "inventado": 1}`. Fíjate en que `size` es un **string**.
7. `GET /documentos` justo después del caso 6. ¿Qué valen `name` y `size`? ¿Sale `job_id`?
8. El mismo `POST /indexar` del caso 6, otra vez.
9. `PATCH /conversaciones/1` con `{"titulo": "   "}`.

Para los campos que no puedes saber (un `job_id` o una fecha), escribe `<uuid>` o `<fecha>`. Lo que cuenta es la **forma**.

**Sube las predicciones antes de ejecutar nada.** El commit deja la hora:

```bash
git add docs/aprendizaje/entregas/dia-03.md
git commit -m "entrega día 03: predicciones"
git push
```

#### Paso 2 — Ejecutar el sondeo (10 min)

Este script llama a la API **sin `lifespan`**: no carga modelos ni necesita Qdrant, Redis ni Docker. Usa SQLite en memoria y apunta Qdrant a un puerto vacío para simular la caída. Es la misma técnica que usan los tests (`tests/api/conftest.py`). Guárdalo **fuera del repo**:

```bash
cat > /tmp/sondeo.py <<'EOF'
"""Sondeo de contratos: llama a la API sin lifespan (sin modelos, Qdrant ni Redis)."""
from fastapi.testclient import TestClient
from qdrant_client import QdrantClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.main import app
from app.db.models import conversation  # noqa: F401  registra las tablas
from app.db.models.document import Base
from app.db.session import get_db
from app.services.cola_port import ColaEnMemoria

motor = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Base.metadata.create_all(motor)
Sesion = sessionmaker(bind=motor, autoflush=False, expire_on_commit=False)


def _db():
    with Sesion() as s:
        yield s


app.dependency_overrides[get_db] = _db
app.state.qdrant = QdrantClient(url="http://localhost:1", timeout=1)  # puerto sin nada: Qdrant "caido"
app.state.cola = ColaEnMemoria()
for nombre in ("dense_embedder", "sparse_embedder", "cross_encoder", "grafo"):
    setattr(app.state, nombre, None)

c = TestClient(app)
CASOS = [
    ("1 GET /health/qdrant", lambda: c.get("/health/qdrant")),
    ("2 POST /indexar (README)", lambda: c.post("/indexar", json={
        "ruta_archivo": "/ruta/absoluta/al/documento.pdf", "nombre": "manual-usuario-v2"})),
    ("3 GET /documentos (vacio)", lambda: c.get("/documentos")),
    ("4 POST /preguntar max=0", lambda: c.post("/preguntar", json={"query": "hola", "max_fragmentos": 0})),
    ("5 POST /preguntar max=999", lambda: c.post("/preguntar", json={"query": "hola", "max_fragmentos": 999})),
    ("6 POST /indexar (raro)", lambda: c.post("/indexar", json={
        "file_path": "/docs/manual.pdf", "type": "pdf", "size": "20480",
        "name": "otro.pdf", "inventado": 1})),
    ("7 GET /documentos (con 1)", lambda: c.get("/documentos")),
    ("8 POST /indexar (repetido)", lambda: c.post("/indexar", json={"file_path": "/docs/manual.pdf", "type": "pdf"})),
    ("9 PATCH titulo vacio", lambda: c.patch("/conversaciones/1", json={"titulo": "   "})),
]
for etiqueta, llamada in CASOS:
    r = llamada()
    print(f"\n### {etiqueta} -> HTTP {r.status_code}")
    print(r.text)
EOF

git switch -c ejercicio/dia-03 origin/main
cd backend
uv sync
APP_DB_URL=sqlite:// PYTHONPATH=. uv run python /tmp/sondeo.py 2>/dev/null
```

`PYTHONPATH=.` hace falta porque el script vive en `/tmp`: sin esa variable, Python no encuentra el paquete `app`.

Pega la salida completa en una sección `## Resultados`. Después añade una tabla `caso | acerté código | acerté forma | qué fallé y por qué`. Para cada fallo, explica qué línea del código te habría dado la respuesta.

#### Paso 3 — La prueba de verdad con Docker (opcional, 15 min)

Si quieres cerrar el criterio que quedó pendiente el día 01, con la API real:

```bash
cd ~/ruta/AGENT4U
docker compose up -d qdrant redis api
docker compose logs -f api                         # espera a "Application startup complete." y sal con Ctrl+C
curl -s -w "\nHTTP %{http_code}\n" http://localhost:8000/health/qdrant
docker compose stop qdrant
curl -s -w "\nHTTP %{http_code}\n" http://localhost:8000/health/qdrant
docker compose start qdrant
```

El `detalle` será distinto al del sondeo, porque en Docker no se rechaza una conexión a un puerto vacío: lo normal es que el nombre `qdrant` deje de resolver cuando el contenedor está parado. Pégalo y explica por qué cambia.

### Parte B — Que el contrato no se vuelva a separar del código

#### Paso 4 — Primero el test, en rojo (20 min)

Crea `backend/tests/api/test_contrato.py`:

```python
"""El contrato de schemas.py frente a lo que la API emite de verdad.

response_model protege los endpoints JSON. /preguntar no tiene esa red: sus
eventos se serializan a mano con json.dumps en traductor_evento, asi que el
unico que puede detectar que el contrato y el codigo se han separado es un test.
"""
import pytest
from pydantic import TypeAdapter

from app.api.schemas import EventoSSE

VALIDAR_EVENTO = TypeAdapter(EventoSSE)


def test_cada_evento_del_stream_cumple_el_contrato(client, grafo_con_pasos, parsear_sse):
    respuesta = client.post("/preguntar", json={"query": "¿Que es CAP?"})
    assert respuesta.status_code == 200

    eventos = parsear_sse([respuesta.text])
    assert {e["tipo"] for e in eventos} >= {"inicio", "paso", "fuentes", "texto", "fin"}

    for evento in eventos:
        VALIDAR_EVENTO.validate_python(evento)


def test_el_evento_error_cumple_el_contrato(client, llm_que_falla, parsear_sse):
    respuesta = client.post("/preguntar", json={"query": "¿Que es CAP?"})

    eventos = parsear_sse([respuesta.text])
    assert eventos[-1]["tipo"] == "error"
    for evento in eventos:
        VALIDAR_EVENTO.validate_python(evento)


@pytest.mark.parametrize("campo", ["hash_content", "user", "job_id"])
def test_documentos_no_expone_campos_internos(client, db, campo):
    from app.db.crud import document as document_crud

    document_crud.crear_documento_encolado(
        db, origen="/docs/a.pdf", nombre="a.pdf", tipo="pdf", tamano=1, job_id="j-1",
    )

    respuesta = client.get("/documentos")

    assert respuesta.status_code == 200
    assert campo not in respuesta.json()["documentos"][0]
```

Antes de ejecutarlo, lee en `tests/conftest.py` qué hacen las fixtures `grafo_con_pasos` (línea 363), `llm_que_falla` (línea 404) y `parsear_sse` (línea 426). Fíjate en que `grafo_con_pasos` recibe el **mismo** objeto `grafo` que usa `client`, y lo modifica.

```bash
cd backend
uv run pytest -q tests/api/test_contrato.py
```

Esperado: **2 failed, 3 passed**, con el error `Input tag 'paso' found using 'tipo' does not match any of the expected tags`. Pega el resumen en la entrega. Los 3 que pasan son los del filtrado de `response_model`: ese contrato sí está protegido.

#### Paso 5 — Añadir `EventoPaso` al contrato (25 min)

En `backend/app/api/schemas.py`, **entre `EventoInicio` y `EventoFuentes`**, añade el modelo. Las cifras opcionales salen de `datos_del_paso` en `services/query_service.py:20-40`: compruébalo tú, nodo por nodo.

```python
class EventoPaso(BaseModel):
    """Un nodo del grafo acaba de terminar. Llega DESPUES del paso, nunca
    antes, porque sale de stream_mode="updates" de LangGraph. Las cifras
    dependen del nodo (ver datos_del_paso en services/query_service.py): el
    backend manda hechos y el frontend pone las palabras."""

    model_config = ConfigDict(extra="forbid")

    tipo: Literal["paso"]
    nodo: str = Field(description="Nombre del nodo del grafo.", examples=["buscar"])
    ms: int = Field(ge=0, description="Milisegundos desde el paso anterior.", examples=[806])
    subconsultas: int | None = Field(default=None, description="Solo en 'multiconsulta'.")
    fragmentos: int | None = Field(default=None, description="Solo en 'buscar' y 'fusionar'.")
    score: float | None = Field(default=None, description="Solo en 'evaluar'.")
    pobre: bool | None = Field(default=None, description="Solo en 'evaluar'.")
    intento: int | None = Field(default=None, description="Solo en 'reescribir'.")
```

Y mételo en la unión:

```python
EventoSSE = Annotated[
    EventoInicio | EventoPaso | EventoFuentes | EventoTexto | EventoError | EventoFin,
    Field(discriminator="tipo"),
]
```

Después actualiza la `description` de `/preguntar` en `routers/query.py:54-65` para que el orden garantizado sea `inicio`, N x `paso`, `fuentes`, N x `texto` y `fin` o `error`, y añade una línea `data: {"tipo": "paso", ...}` al `example` de la línea 72.

```bash
uv run pytest -q tests/api/test_contrato.py      # 5 passed
```

**Comprueba que `extra="forbid"` sirve para algo:** añade temporalmente `"inventado": 1` al diccionario de `traductor_evento("paso", {...})` en `query_service.py`, vuelve a ejecutar el test y pega el error (debe mencionar `paso.inventado`). Después **deshaz** el cambio.

#### Paso 6 — Quitar el código muerto (15 min)

Primero demuestra que está muerto, buscando **usos**, no definiciones (es la lección del día 01):

```bash
cd ..
grep -rn "IndexacionOut\|FicheroSubidoOut\|IndexacionSaturada" \
  --include=*.py --include=*.ts --include=*.tsx . | grep -v node_modules
cd backend
```

Si solo salen las 3 líneas `class ...`:
- Borra `IndexacionOut` y `FicheroSubidoOut` de `schemas.py`.
- Borra `IndexacionSaturada` de `exceptions.py`.
- Corrige la anotación `conversacion_id: str` de `ConversacionNoEncontrada` a `int`.

#### Paso 7 — Arreglar *Uso de la API* del README (20 min)

Reescribe la sección `## Uso de la API` del `README.md` raíz con los contratos **reales**:
- Cuántos endpoints hay y dónde verlos (`/docs`).
- El `curl` de `/indexar` con `file_path` y `type`, y su respuesta `202` con `job_id`. Añade cómo seguir el trabajo con `GET /trabajos/{job_id}`.
- El `curl -N` de `/preguntar` y un ejemplo de 4-5 líneas `data:` reales, incluido un `paso`.
- Una nota sobre las dos formas del 422.

Usa las salidas de tu Paso 2 como fuente, no la píldora.

#### Paso 8 — Validar y subir (10 min)

```bash
uv run pytest -q                       # en main hay 91 tests; tú debes tener 96 en verde
uv run ruff check app tests
cd ..
git add backend/app/api/schemas.py backend/app/api/routers/query.py \
        backend/app/core/exceptions.py backend/tests/api/test_contrato.py README.md
git diff --cached --stat               # revisa que no se cuela nada más
git commit -m "fix(api): evento paso en el contrato SSE, test de contrato y limpieza de esquemas"
git push -u origin ejercicio/dia-03
```

### Preguntas (responde con tus palabras en la entrega)

1. ¿Por qué `_vacio_a_none` tiene que ser `mode="before"`? ¿Qué pasaría exactamente con `{"conversacion_id": ""}` si fuera `"after"`?
2. En el caso 6, `size: "20480"` se aceptó y `inventado` desapareció. Explica las dos cosas. ¿Pondrías `extra="forbid"` en `QueryRequest`? Da un argumento a favor y otro en contra, pensando en el gateway y en clientes viejos.
3. ¿Qué diferencia hay entre `response_model=DocumentoOut` y `responses={404: {"model": ErrorOut}}`? ¿Cuál de los dos te protege de verdad, y cuál puede mentir?
4. ¿Por qué el test de los eventos falló y el de `hash_content` pasó, si los dos comprueban "el contrato"? Relaciónalo con `json.dumps` en `traductor_evento`.
5. Propón **dos** formas de que un evento nuevo no pueda volver a salir sin estar en el contrato, además del test que has escrito. Pista: ¿qué pasaría si `traductor_evento` recibiera un modelo en vez de `(tipo, dict)`? ¿Qué cuesta eso?
6. Las dos formas del 422: ¿cómo las unificarías? Compara dos opciones: mover la validación del tope a un `field_validator` de `QueryRequest`, o registrar un `@app.exception_handler(RequestValidationError)` que aplane el `detail`. ¿Qué rompe cada una en el frontend (`cliente.ts:130-148`)?
7. `GET /documentos` responde 404 si está vacío. ¿Qué tendrías que cambiar, y en qué tres sitios (backend, gateway y tests), para que responda `200` con lista vacía?
8. El contrato existe en tres copias (Pydantic, Strawberry y TypeScript). ¿Qué ganarías generando los tipos TypeScript desde `/openapi.json`? ¿Por qué no basta para el frontend de AGENT4U, que habla con el **gateway** y no con el backend?
9. Explica con tus palabras el bug del 409 en `/indexar-fichero`. ¿En qué orden deberían ir las operaciones para que no pase? No hace falta que lo implementes.

### Criterios de aceptación

- [ ] El commit `entrega día 03: predicciones` está en `origin/aprendizaje` y es **anterior** al resto de la entrega (`git log --format='%h %ad %s' -- docs/aprendizaje/entregas/dia-03.md`).
- [ ] Las 9 predicciones con código HTTP y forma del JSON.
- [ ] La salida **real** del sondeo pegada tal cual, y la tabla de aciertos y fallos con la línea de código que lo explica.
- [ ] Rama `ejercicio/dia-03` en el remoto, creada desde `main`.
- [ ] Salida del Paso 4 en rojo (`2 failed, 3 passed`) y después en verde.
- [ ] `EventoPaso` en `schemas.py` y dentro de `EventoSSE`; la descripción de `/preguntar` menciona `paso`.
- [ ] Error de `extra="forbid"` pegado, y el cambio temporal deshecho (`git diff origin/main -- backend/app/services` vacío).
- [ ] `grep -rn "IndexacionOut\|FicheroSubidoOut\|IndexacionSaturada" backend/` no devuelve nada.
- [ ] `uv run pytest -q` con 96 tests en verde y `uv run ruff check app tests` sin errores (pega el resumen).
- [ ] `README.md`, sección *Uso de la API*, con los campos y respuestas reales.
- [ ] Las 9 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

Entrega final (antes de las 8:30 del **lunes 26-oct**):

```bash
git switch aprendizaje && git pull
# ...completa dia-03.md con resultados, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-03.md
git commit -m "entrega día 03" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code con `XX = 03`, estando en tu rama `ejercicio/dia-03`.

---

## 5. Para profundizar (opcional)

- FastAPI, *Response Model* (filtrado, `response_model_exclude_unset` y compañía): https://fastapi.tiangolo.com/tutorial/response-model/
- Pydantic, uniones discriminadas: https://docs.pydantic.dev/latest/concepts/unions/#discriminated-unions

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la primera mitad de la sección *3. API: contratos y routers* debería cubrir:
- Dónde vive el contrato (`schemas.py`) y cómo se aplica: validación de entrada con 422 y filtrado de salida con `response_model` y `from_attributes`.
- La regla de errores: excepciones de dominio en los servicios, traducidas a `HTTPException` en el router, con cuerpo `ErrorOut`. Y la excepción: los 200 con `status` de `/health/qdrant` y del borrado de documentos.
- La debilidad estructural: el stream SSE no pasa por Pydantic y el contrato está copiado a mano en gateway y frontend. Qué lo protege hoy (tu test).

Si te da tiempo, escribe también los párrafos de las secciones 1 y 2, que siguen vacíos.

**El lunes 26-oct (día 04):** routers de FastAPI, `Depends` y `app.state`. Veremos cómo se inyecta la sesión de base de datos con `get_db` y por qué los tests la sustituyen con `dependency_overrides` (ya lo has usado hoy sin saberlo, en el sondeo). Crearás tu propio endpoint `GET /stats` con su esquema de salida, y su test.
