# Píldora 05 — Ingesta asíncrona: API → cola → Redis/ARQ → worker

**Miércoles 28-oct-2026 · 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 04

No hay entrega del día 04: en `origin/aprendizaje` no existe `entregas/dia-04.md` y en el remoto no hay rama `ejercicio/dia-04`. Tampoco han llegado tarde la 02 ni la 03. Sin nota.

Son tres seguidas. No te voy a repetir el sermón: si hoy solo tienes 15 minutos, haz **el Paso 6** (el arreglo del 503 con sus tests). Es un bug real, el arreglo son 20 líneas y te deja una entrega que se puede criticar. Del día 04, lo que más vale recuperar es el **Paso 2** (el script de `/tmp/orden.py`, 7 minutos), porque corrige un comentario que hoy miente en `query_service.py`.

`main` no ha cambiado desde el día 01 (`fb93eea`), así que todo lo que sigue está comprobado contra el mismo código.

---

## 1. Concepto clave: una cola de trabajos, y quién manda sobre el estado

### 1.1 El problema que resuelve

Indexar un PDF con Docling cuesta del orden de un minuto y medio (lo dice el propio README, en *Ideas anotadas para la ingesta*). Si eso pasa **dentro** de la petición HTTP:

- el cliente se queda colgado ese tiempo, y cualquier proxy con un *timeout* de 60 s corta la conexión aunque la indexación siga;
- cada indexación ocupa un hilo del threadpool del servidor (día 04), y con varias a la vez el proceso se queda sin hilos ni memoria;
- si el servidor se reinicia a mitad, el trabajo se pierde sin dejar rastro.

La solución clásica es **separar "aceptar el trabajo" de "hacer el trabajo"**: la API apunta el encargo en una cola y responde enseguida `202 Accepted` con un identificador; otro proceso (el *worker*) saca encargos de la cola y los ejecuta; el cliente pregunta por el identificador cada cierto tiempo (*polling*).

### 1.2 Las tres piezas: broker, productor y consumidor

- **Broker:** el almacén de la cola. Aquí es **Redis**, una base de datos en memoria con estructuras (cadenas, listas, conjuntos ordenados) y operaciones atómicas.
- **Productor:** quien mete trabajos. Aquí es la API, con `pool.enqueue_job(...)`.
- **Consumidor:** quien los saca y los ejecuta. Aquí es el worker, un proceso aparte (`python -m app.worker`).

### 1.3 ARQ en cinco ideas

ARQ es una librería de colas para `asyncio` sobre Redis, mucho más pequeña que Celery. Versión fijada en vuestro `uv.lock`: **0.28.0**. Lo que necesitas saber:

1. **Un trabajo es una llamada a función serializada.** `enqueue_job("indexar_job", a, b, c, _job_id="idx:...")` guarda en Redis el nombre de la función y sus argumentos (con `pickle`). El worker tiene una lista `functions = [indexar_job]` y llama a la que coincide por nombre, pasándole como primer argumento un `ctx` (un diccionario compartido).
2. **Las claves en Redis** (lo verás en el ejercicio):
   - `arq:queue`: un *sorted set* con los ids pendientes; la puntuación es el instante (en ms) en que pueden ejecutarse.
   - `arq:job:<id>`: el trabajo serializado. **Caduca**: por defecto, un día después de su hora prevista de inicio.
   - `arq:in-progress:<id>`: un "candado" mientras un worker lo ejecuta. Dura `job_timeout + 10 s`.
   - `arq:result:<id>`: el resultado o la excepción, durante una hora (`keep_result=3600`).
3. **`_job_id` deduplica.** Si ya existe un trabajo o un resultado con ese id, `enqueue_job` no encola nada y devuelve `None` (lo he comprobado: el segundo `enqueue_job` con el mismo id devuelve `None`).
4. **Reintentos.** Una excepción normal marca el trabajo como fallido y **no se reintenta**. Solo se reintenta si lanzas `arq.Retry`, si el trabajo se cancela por un apagado ordenado del worker, o si el worker muere y otro lo recoge cuando caduca el candado `in-progress`. Hasta `max_tries=5`.
5. **Timeout.** ARQ ejecuta cada trabajo dentro de `asyncio.wait_for(tarea, job_timeout)`. Al vencer, **cancela** la corrutina: dentro aparece un `asyncio.CancelledError`, que **no** es `Exception` (hereda de `BaseException`). Volveremos a esto en la sección 3, porque es un bug.

### 1.4 La pregunta que define el diseño: ¿dónde vive el estado?

En un sistema con cola hay **dos** sitios que saben cosas del trabajo: el broker (Redis/ARQ) y tu base de datos. Hay que decidir cuál es la **fuente de verdad**, porque se van a desincronizar (Redis se vacía, un proceso muere a mitad, un trabajo caduca). AGENT4U eligió **SQLite**: el estado del documento (`en-cola` → `indexando` → `indexado` / `error`) se guarda en la tabla `documents`, y tanto el cupo (429) como `GET /trabajos/{id}` leen de ahí. Redis solo transporta el encargo. Es una buena decisión, pero tiene una consecuencia que hoy vas a provocar con tus manos: **si Redis y SQLite discrepan, nadie lo arregla**.

---

## 2. Cómo está en AGENT4U

### 2.1 El recorrido completo de un `POST /indexar`

```text
cliente ── POST /indexar ──▶ api: indexar()                         routers/indexation.py:92
                               ├─ _comprobar_cupo(cola)              :40   lee SQLite (en_vuelo)
                               │     └─ ≥ 5 en vuelo → 429 + Retry-After: 120
                               └─ _encolar_trabajo(cola, db, ...)   :51
                                     ├─ INSERT documents (state='en-cola', job_id=uuid)  SQLite
                                     │     └─ cualquier excepción → DocumentoYaExiste → 409
                                     └─ cola.encolar(job_id, ...)    services/cola_arq.py:24
                                           └─ enqueue_job("indexar_job", ..., _job_id="idx:<uuid>")  Redis
                             ◀── 202 {"job_id": "...", "status": "en-cola"}

worker (otro proceso) ── saca idx:<uuid> de arq:queue
   indexar_job(ctx, job_id, file_path, type, size)                  worker/jobs.py:21
     ├─ SELECT por job_id; si no existe → return (lo borraron)      :34-37
     ├─ UPDATE state='indexando'                                    SQLite
     ├─ borrar_por_origen(qdrant, origin)                           :43   idempotencia
     ├─ await asyncio.to_thread(_trabajo)  Docling + embeddings + upsert   :58
     ├─ éxito → _marcar_estado_final(num_chunks) → 'indexado'       :64
     └─ except Exception → borrar vectores, 'error', y re-lanza     :59-62

cliente ── GET /trabajos/{job_id} (cada 5 s) ──▶ api: lee SQLite   routers/jobs.py
```

El frontend sondea a 500 ms la primera vez y luego cada 5 s (`POLL_PRIMER_MS` y `POLL_MS` en `frontend/src/features/documentos/useIngesta.ts:25-26`), a través del gateway (`gateway/app/clients/http_client.py:41`).

### 2.2 El puerto: `services/cola_port.py`

```python
@runtime_checkable
class ColaIndexacion(Protocol):
    async def encolar(self, job_id: str, *, file_path: str, type: str,
                      size: int | None) -> None: ...
    async def en_vuelo(self) -> int: ...
    async def close(self) -> None: ...
```

Es el patrón **puertos y adaptadores** (arquitectura hexagonal): la API depende de una interfaz (`ColaIndexacion`) y no de ARQ. Hay dos adaptadores: `ColaArq` (producción) y `ColaEnMemoria` (tests). Un `Protocol` es **tipado estructural**: una clase lo cumple si tiene esos métodos, sin heredar de él. `@runtime_checkable` permite `isinstance(cola, ColaIndexacion)` (lo usa `tests/unit/test_cola_port.py:12`), pero ojo: solo comprueba que los **nombres** de los métodos existen, no sus firmas ni que sean `async`.

### 2.3 El adaptador real: `services/cola_arq.py` (40 líneas)

```python
async def _get_pool(self) -> ArqRedis:                     # :19
    if self._pool is None:
        self._pool = await create_pool(self._redis_settings)
    return self._pool

async def encolar(self, job_id, *, file_path, type, size):  # :24
    pool = await self._get_pool()
    await pool.enqueue_job("indexar_job", job_id, file_path, type, size,
                           _job_id=f"idx:{job_id}")

async def en_vuelo(self) -> int:                            # :33
    with SessionLocal() as sesion:
        return document_crud.contar_en_vuelo(sesion)
```

Tres cosas:

- **El pool se crea perezosamente**, en el primer `encolar`, no en el `lifespan`. Por eso la API arranca aunque Redis esté caído, y el fallo aparece en la primera indexación (sección 3).
- **El trabajo se identifica por su nombre como cadena** (`"indexar_job"`). La API no importa el código del worker. Si alguien renombra la función en `worker/jobs.py`, la API seguirá encolando trabajos que el worker no sabe ejecutar, y ningún test lo detecta (los tests usan `ColaEnMemoria`).
- **`en_vuelo` no pregunta a Redis.** Cuenta filas de SQLite con `state IN ('en-cola', 'indexando')` (`db/crud/document.py:47-50`). Esa es la fuente de verdad de la que hablaba la sección 1.4.

### 2.4 El cupo: `_comprobar_cupo` y `index_max_en_vuelo`

```python
# core/config.py
index_max_concurrentes: int = 1     # cuántas corren a la vez (max_jobs del worker)
index_max_en_cola: int = 4          # cuántas pueden esperar

@property
def index_max_en_vuelo(self) -> int:
    return self.index_max_concurrentes + self.index_max_en_cola   # 5
```

Con 5 documentos en `en-cola` o `indexando`, el sexto recibe `429 Too Many Requests` con `Retry-After: 120` (`indexation.py:24` y `:40-48`). El mismo `index_max_concurrentes` se usa como `max_jobs` del worker (`worker/settings.py:54`), así que el límite de la API y el del worker salen de un único número. Y el frontend lo pide por `GET /ajustes` para no mandar más de lo que cabe (`frontend/src/features/documentos/ingesta.ts`, `huecosLibres` y `repartir`). Es lo que explica el docstring de `index_max_en_vuelo`: *"dos copias de un límite son dos copias que acaban discrepando"*.

### 2.5 El worker: `worker/settings.py` y `worker/jobs.py`

```python
class WorkerSettings:                                   # settings.py:51
    functions = [indexar_job]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = get_settings().index_max_concurrentes    # 1
    job_timeout = 7200                                  # 2 horas
    on_startup = startup
    on_shutdown = shutdown
```

- `startup` es el `lifespan` del worker: carga una vez el embedder denso, el BM25, el cliente de Qdrant, el `DocumentConverter` y el `HybridChunker`, y los deja en `ctx`. **No** carga el cross-encoder ni el grafo, que solo sirven para consultar. Los imports van dentro de la función para que importar `WorkerSettings` (por ejemplo, desde un test) no arrastre Docling.
- `indexar_job` es `async` porque ARQ lo llama desde su event loop, pero todo lo pesado es síncrono y CPU, así que va a un hilo con `asyncio.to_thread(_trabajo)`. Es la misma regla del día 04 (`run_in_threadpool`), con la herramienta estándar de `asyncio`. Aquí sí está bien aplicada.
- **Abre y cierra su propia sesión dos veces** (`:34` y `:69`) y no mantiene ninguna abierta durante el minuto que tarda Docling. Con SQLite, que bloquea la base entera en cada escritura, una sesión larga en el worker bloquearía los `INSERT` de la API (que esperarían hasta el `timeout: 30` de `session.py`).
- **Es idempotente:** `borrar_por_origen` *antes* de vectorizar (`:43`). Si el trabajo se ejecuta dos veces (un reintento tras un apagado, por ejemplo), la segunda no duplica fragmentos. Lo prueba `tests/integration/test_worker_jobs.py::test_job_limpia_vectores_antes_de_empezar`.
- **Tolera que el documento desaparezca:** si el usuario lo borró mientras esperaba, `obtener_por_job_id` devuelve `None` y el trabajo termina sin hacer nada (`test_job_con_documento_borrado_sale_limpio`).

### 2.6 Las tres rutas, y en qué se diferencian

| Ruta | `origin` que se guarda | `type` | Particularidad |
|---|---|---|---|
| `POST /indexar` | `file_path` del cuerpo | el del cuerpo, sin validar | La ruta tiene que existir **en la máquina del worker**, no en la del cliente |
| `POST /indexar-url` | la URL | `"url"` | Docling la descarga desde el worker |
| `POST /indexar-fichero` | la ruta donde se guardó en `upload_dir` | la extensión (o `"txt"`) | Sube el fichero en trozos de 1 MB, con tope de 50 MB, y lo escribe en un `.parcial` que se renombra con `os.replace` |

En Docker, API y worker comparten el volumen `uploads_data` en `/uploads` (`docker-compose.yml`). Sin ese volumen, el worker no encontraría lo que subió la API. Es la razón de que estén las dos en la misma imagen y con los mismos volúmenes.

### 2.7 Lo que prueban los tests (y lo que no)

`tests/api/test_indexation.py` y `test_indexation_concurrencia.py` comprueban 202, 409, 422 y 429, y que un 429 no deja ni fila ni fichero. `tests/integration/test_worker_jobs.py` llama a `indexar_job` directamente con un `ctx` falso. **Ningún test arranca ARQ ni Redis**: el contrato entre `ColaArq.encolar` y el worker (el nombre `"indexar_job"` y el orden de los argumentos) no está cubierto.

Y hay una diferencia sutil: `ColaEnMemoria.en_vuelo()` cuenta **su propia lista** de trabajos encolados (`cola_port.py:49-50`), mientras que `ColaArq.en_vuelo()` cuenta **filas de SQLite**. El doble no se comporta como el original. Por eso los tests del 429 tienen que poner el cupo a 0 con `monkeypatch` en vez de llenar la base: con el doble, meter 5 filas `en-cola` en SQLite no provoca un 429.

---

## 3. Por qué se montó así (y qué no cuadra)

### Decisiones

1. **Cola + `202` + sondeo, en vez de indexar dentro de la petición.** Es lo que separa la latencia de la petición de la duración del trabajo, y lo que permite limitar la concurrencia en un solo sitio. Alternativas:
   - *`BackgroundTasks` de FastAPI:* sin infraestructura nueva, pero corre dentro del proceso de la API (compite por CPU con las consultas) y se pierde si la API se reinicia.
   - *Celery:* más maduro (reintentos con *backoff*, *routing*, monitorización con Flower), pero síncrono de origen, más pesado y con más configuración.
   - *RQ:* simple, pero síncrono.
   - *ARQ:* nativo `asyncio`, encaja con FastAPI y cabe en 40 líneas de adaptador.

   *Coste:* dos servicios más (Redis y el worker), dos fuentes de estado que hay que mantener coherentes, y un cliente que tiene que sondear. Con WebSockets o SSE el servidor podría avisar al terminar, pero eso exige un canal de vuelta del worker a la API (por ejemplo, Redis pub/sub) que hoy no existe.

2. **SQLite como fuente de verdad del estado, y no el resultado de ARQ.** El estado tiene que sobrevivir a la hora de `keep_result` y tiene que estar en la misma tabla que lista la UI. Además, `GET /trabajos/{id}` no necesita hablar con Redis. *Coste:* hay que escribir el estado a mano en cada transición, y cualquier camino que no lo escriba deja un documento colgado. Los tres bugs de abajo son exactamente eso.

3. **Un puerto (`ColaIndexacion`) con dos adaptadores.** Hace que los tests de la API no necesiten Redis y que cambiar de broker sea un cambio local. *Coste:* el doble no es fiel (sección 2.7), y el contrato real no tiene ningún test.

4. **`max_jobs = 1`.** El comentario de `config.py:29-32` lo justifica bien: Docling y ONNX ya usan todos los núcleos, así que dos indexaciones a la vez van **peor** que una detrás de otra. Para escalar, el camino es más máquinas con un worker cada una, no más trabajos por worker.

5. **`job_timeout = 7200`.** Holgado a propósito para un PDF grande con tablas. *Coste:* un trabajo colgado (un PDF patológico, una URL que no responde) ocupa el único hueco del worker durante dos horas.

### Cosas que no cuadran (comprobadas hoy contra `main`)

- 🔴 **Si Redis falla al encolar, queda una fila fantasma para siempre.** `_encolar_trabajo` (`indexation.py:51-69`) hace primero el `INSERT` con `state='en-cola'` y su `commit`, y **después** `await cola.encolar(...)`. Si el segundo paso lanza (Redis caído, red, *timeout*), la excepción sube como 500, pero la fila ya está escrita. Lo he reproducido con una cola que falla al encolar:

  ```text
  POST /indexar → 500    documents: [('/docs/manual.pdf', 'en-cola')]
  POST /indexar (reintento, con la cola ya sana) → 409
  ```

  Ese documento cuenta para el cupo para siempre, ningún worker lo va a procesar, y el origen queda bloqueado con un 409 que dice *"ya está indexado"*. Cinco fallos así y la API responde 429 a todo, permanentemente. Lo arreglas hoy (Paso 6).

- 🔴 **Un `job_timeout` deja el documento en `indexando` para siempre.** Cuando ARQ cancela el trabajo, dentro de `indexar_job` salta `CancelledError`, que **no** captura el `except Exception` de `jobs.py:59`. Lo he comprobado con ARQ 0.28 y un trabajo de 3 s con `job_timeout=1`: el `except Exception` **no** se ejecuta, solo el `finally`, y ARQ lo cuenta como `failed: 1, retried: 0` (no lo reintenta). Resultado: el documento se queda en `indexando`, ocupando cupo. Y hay algo peor: `asyncio.to_thread` **no se puede cancelar**. El hilo sigue ejecutando Docling y el `upsert` en Qdrant después del timeout, así que los vectores pueden acabar escritos con el documento marcado como colgado. Hoy lo dejas fijado con un test `xfail` (Paso 6). Arreglarlo bien no es trivial: hay que decidir qué hacer con un hilo que no puedes parar.

- 🟠 **Más caminos al mismo estado colgado.** El worker muere de golpe (`kill -9`, OOM) a mitad: el documento queda en `indexando` y ARQ solo lo recoge otra vez cuando caduca el candado `in-progress`, a las **2 h y 10 s** (`job_timeout + 10`). Si Redis pierde los datos (el `FLUSHALL` del Paso 5, un reinicio sin persistencia), o el worker está parado más de un día y el trabajo caduca, la fila queda en `en-cola` para siempre. El patrón que falta tiene nombre: un **reconciliador**. Un proceso (al arrancar el worker, o periódico) que busca filas `en-cola`/`indexando` más viejas que X y sin trabajo vivo en Redis, y las pasa a `error` o las vuelve a encolar.

- 🟠 **`DELETE /documentos/{nombre}` durante `indexando` deja vectores huérfanos.** El `DELETE` borra la fila y los vectores, pero el worker sigue: termina el `upsert` y, en `_marcar_estado_final` (`jobs.py:67-72`), no encuentra la fila y hace `return` sin más. Los fragmentos se quedan en Qdrant sin ningún documento en la base que los liste o los pueda borrar, y seguirán apareciendo en las respuestas del RAG.

- 🟠 **El bug del 409 en `/indexar-fichero` sigue ahí** (lo viste el día 03). `os.replace(parcial, destino)` (`indexation.py:179`) se ejecuta **antes** de saber si el origen ya existe, que se comprueba en `_encolar_trabajo` (`:197-203`). Subir otro `informe.pdf` pisa el fichero en disco, responde 409 y deja los vectores del contenido viejo. El orden correcto es: comprobar cupo → comprobar o reservar el origen en la base → escribir el fichero → encolar. Y fíjate en que el cupo también se comprueba **después** de recibir y escribir hasta 50 MB (`:191-195`): el cliente sube el fichero entero para recibir un 429.

- 🟡 **La comprobación del cupo no es atómica, y hoy funciona por casualidad.** `_comprobar_cupo` lee el contador y `_encolar_trabajo` inserta la fila después (*check-then-act*). Dos peticiones simultáneas podrían leer 4 a la vez y entrar las dos. Hoy no pasa porque, entre la lectura y el `INSERT`, **no hay ningún `await` real**: `ColaArq.en_vuelo()` es `async` solo de nombre y el `commit` es síncrono, así que el event loop no puede intercalar otra petición. Es decir, el bloqueo del event loop del día 04 está tapando una condición de carrera. En cuanto lo arregles con `run_in_threadpool`, o arranques `uvicorn --workers 2`, el cupo se podrá superar. La solución robusta es contar e insertar en la misma transacción, o usar un contador atómico en Redis (`INCR`).

- 🟡 **El worker de Docker no deja log de los trabajos.** `worker/__main__.py` llama a `run_worker(WorkerSettings)`, y `run_worker` no configura `logging` (en ARQ eso lo hace la CLI `arq`, con `logging.config.dictConfig`). Los mensajes de ARQ son de nivel `INFO` y, sin configuración, Python solo enseña `WARNING` o superior. Lo he comprobado: un worker lanzado así procesa el trabajo sin escribir nada. Resultado: `docker compose logs worker` no te dice qué trabajos empezaron ni cuánto tardaron, solo las trazas de los que fallan. Se arregla con `command: ["arq", "app.worker.settings.WorkerSettings"]` en `docker-compose.yml`, o configurando `logging` en `__main__.py`.

- 🟡 **Comentarios y documentación que se quedaron atrás.**
  - `config.py:34-36` justifica el techo de cola con que *"una avalancha llena el threadpool de hilos bloqueados"*. Eso era verdad cuando `/indexar` indexaba dentro de la petición. Hoy la indexación no ocupa hilos de la API: el techo protege la memoria y el tiempo de espera del worker, y evita colas que el usuario tardaría horas en ver procesadas.
  - El docstring de `ColaEnMemoria` dice que es un doble *"para tests y para el arranque sin Redis"*. No existe ningún arranque sin Redis: el `lifespan` crea siempre `ColaArq` (`lifespan.py`), y `ColaEnMemoria` solo aparece en tests.
  - El día 01 te dije que el volumen `model_cache` guardaba la caché de modelos, con `HF_HOME=/models/hf`. Es verdad para Docling y el tokenizer, **pero no para fastembed**: fastembed usa `FASTEMBED_CACHE_PATH` o, si no está, `tempfile.gettempdir()/fastembed_cache` (`fastembed/common/utils.py:53-54`). Como el `Dockerfile` no define esa variable, e5-large se descarga dentro de `/tmp` del contenedor, por separado en la API y en el worker, y se vuelve a descargar cada vez que se recrea un contenedor. El README (*Sin Docker*) dice lo mismo que dije yo (`~/.cache/huggingface/`). La corrección es una línea en el `Dockerfile`: `ENV FASTEMBED_CACHE_PATH=/models/fastembed`.

---

## 4. Ejercicio (≈40 min): sigue un trabajo de punta a punta, rómpelo y arregla un fantasma

**Rama de código:** `ejercicio/dia-05`, creada desde `main`.
**Entrega:** `docs/aprendizaje/entregas/dia-05.md`, en la rama `aprendizaje`, **antes de las 8:30 del viernes 30-oct**.

La primera mitad es de observación: levantas la API y el worker en local, aislados de tus datos reales, y miras qué hay en SQLite y en Redis en cada momento. La segunda es de código: arreglas el bug de la fila fantasma con TDD (primero el test en rojo, luego el arreglo).

> Necesitas Docker para Qdrant y Redis. Si tu caché de fastembed se borró (vive en `/tmp`, sección 3), el primer arranque de la API y del worker vuelve a descargar los modelos (unos minutos). Arranca el Paso 2 lo primero y lee mientras.

### Paso 1 — Rama y punto de partida (2 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-05 origin/main
cd backend
uv sync
uv run pytest -q          # punto de partida: 91 passed
```

### Paso 2 — Infraestructura y API, aisladas de tus datos (5 min)

Para no ensuciar tu `agent4u.db` ni tu colección de Qdrant, usa una base y una colección propias del ejercicio. Las variables de entorno mandan sobre el `.env` (día 02), así que tu clave de Gemini se sigue leyendo de ahí.

```bash
cd ~/ruta/AGENT4U
docker compose up -d qdrant redis

mkdir -p /tmp/agent4u-dia05
cat > /tmp/agent4u-dia05/env <<'EOF'
export APP_DB_URL=sqlite:////tmp/agent4u-dia05/dia05.db
export APP_QDRANT_COLLECTION=dia05
EOF

for i in 1 2 3 4 5 6 7; do
  printf "# Documento %s\n\nTexto de prueba del dia 05, documento numero %s.\n" "$i" "$i" \
    > /tmp/agent4u-dia05/doc$i.md
done
ls /tmp/agent4u-dia05
```

Usamos `.md` porque Docling no tiene formato `txt` (su lista de formatos incluye `md`, `pdf`, `docx`, `html`... pero no `txt`), y porque un Markdown se convierte en milisegundos.

**Terminal A** (la API; déjala abierta):

```bash
cd ~/ruta/AGENT4U/backend
source /tmp/agent4u-dia05/env
uv run uvicorn app.api.main:app --port 8000
```

**Terminal C** (la de trabajo). Espera a que la API responda:

```bash
until curl -sf localhost:8000/health; do sleep 3; done; echo
```

**No arranques el worker todavía.**

### Paso 3 — Llenar la cola sin worker y forzar el 429 (8 min)

En la terminal C:

```bash
cd /tmp/agent4u-dia05
: > ids.txt
for i in 1 2 3 4 5 6; do
  codigo=$(curl -s -o r$i.json -w "%{http_code}" -X POST localhost:8000/indexar \
    -H 'Content-Type: application/json' \
    -d "{\"file_path\": \"/tmp/agent4u-dia05/doc$i.md\", \"type\": \"md\"}")
  echo "doc$i -> $codigo"
  if [ "$codigo" = "202" ]; then
    python3 -c "import json; print(json.load(open('r$i.json'))['job_id'])" >> ids.txt
  fi
done
cat ids.txt
```

Deberías ver cinco `202` y un `429`. Mira la cabecera del 429:

```bash
curl -si -X POST localhost:8000/indexar -H 'Content-Type: application/json' \
  -d '{"file_path": "/tmp/agent4u-dia05/doc6.md", "type": "md"}' | head -8
```

Ahora mira los dos almacenes. Primero SQLite, a través de la API:

```bash
curl -s localhost:8000/trabajos/$(head -1 ids.txt); echo
```

Y luego Redis, directamente:

```bash
cd ~/ruta/AGENT4U
docker compose exec redis redis-cli KEYS 'arq:*'
docker compose exec redis redis-cli ZCARD arq:queue
docker compose exec redis redis-cli ZRANGE arq:queue 0 -1 WITHSCORES
docker compose exec redis redis-cli PTTL "arq:job:idx:$(head -1 /tmp/agent4u-dia05/ids.txt)"
```

Pega todas las salidas en la entrega. Convierte la `PTTL` (milisegundos) a horas y explica qué significa (pregunta 2).

### Paso 4 — Arrancar el worker y ver cómo se vacía la cola (6 min)

**Terminal B** (el worker):

```bash
cd ~/ruta/AGENT4U/backend
source /tmp/agent4u-dia05/env
uv run arq app.worker.settings.WorkerSettings
```

Arrancamos el worker con la CLI de ARQ y **no** con `python -m app.worker`, que es lo que usa `docker-compose.yml`. Es a propósito: la CLI configura el `logging` y `run_worker` no, así que con `python -m app.worker` no verías ni una línea de los trabajos (sección 3).

En la terminal C, sondea los cinco trabajos cada 2 segundos hasta que estén todos en `indexado` (y corta con `Ctrl+C`):

```bash
cd /tmp/agent4u-dia05
while true; do
  for id in $(cat ids.txt); do
    curl -s localhost:8000/trabajos/$id | python3 -c \
      "import sys, json; d = json.load(sys.stdin); print(d['name'], d['status'], d['num_chunks'])"
  done
  echo ---; sleep 2
done
```

Fíjate en el log de la terminal B: verás una línea `→ idx:...:indexar_job(...)` al empezar cada trabajo y otra `←` al terminar, **de uno en uno** (`max_jobs = 1`). Pega en la entrega un trozo del log y una vuelta del sondeo en la que convivan estados distintos (si va demasiado rápido para verlo, di qué viste).

Comprueba que ahora el sexto sí entra:

```bash
curl -s -X POST localhost:8000/indexar -H 'Content-Type: application/json' \
  -d '{"file_path": "/tmp/agent4u-dia05/doc6.md", "type": "md"}'; echo
```

### Paso 5 — Desincronizar Redis y SQLite a propósito (5 min)

Para el worker con `Ctrl+C` en la terminal B. En la C, encola el `doc7` y vacía Redis:

```bash
curl -s -X POST localhost:8000/indexar -H 'Content-Type: application/json' \
  -d '{"file_path": "/tmp/agent4u-dia05/doc7.md", "type": "md"}' | tee /tmp/agent4u-dia05/r7.json; echo
cd ~/ruta/AGENT4U
docker compose exec redis redis-cli FLUSHALL
```

Vuelve a arrancar el worker en la terminal B (`uv run arq app.worker.settings.WorkerSettings`), espera 20 segundos y pregunta por el `doc7`:

```bash
ID7=$(python3 -c "import json; print(json.load(open('/tmp/agent4u-dia05/r7.json'))['job_id'])")
curl -s localhost:8000/trabajos/$ID7; echo
curl -s -o /dev/null -w "reindexar doc7 -> %{http_code}\n" -X POST localhost:8000/indexar \
  -H 'Content-Type: application/json' \
  -d '{"file_path": "/tmp/agent4u-dia05/doc7.md", "type": "md"}'
```

Deberías ver `en-cola` (para siempre) y un `409`. Acabas de fabricar a mano un documento fantasma. Límpialo y apaga todo:

```bash
curl -s -X DELETE localhost:8000/documentos/doc7.md; echo
# Ctrl+C en las terminales A y B
docker compose stop qdrant redis
```

### Paso 6 — TDD: el fantasma por fallo al encolar, y el timeout del worker (12 min)

**6.1 El test en rojo.** Crea `backend/tests/api/test_cola_caida.py`:

```python
"""Que pasa si Redis falla justo al encolar."""
from app.api.main import app
from app.services.cola_port import ColaEnMemoria

CUERPO = {"file_path": "/docs/manual.pdf", "name": "manual.pdf", "type": "pdf", "size": 10}


class ColaCaida(ColaEnMemoria):
    """Acepta la consulta de cupo, pero falla al encolar, como un Redis caido."""

    async def encolar(self, job_id, *, file_path, type, size):
        raise ConnectionError("Redis no responde")


def test_si_la_cola_falla_no_queda_fila_fantasma(client, documentos_frescos):
    app.state.cola = ColaCaida()

    respuesta = client.post("/indexar", json=CUERPO)

    assert respuesta.status_code == 503
    assert respuesta.headers["retry-after"] == "30"
    assert documentos_frescos() == []


def test_tras_el_fallo_el_origen_sigue_libre(client):
    app.state.cola = ColaCaida()
    client.post("/indexar", json=CUERPO)

    app.state.cola = ColaEnMemoria()
    assert client.post("/indexar", json=CUERPO).status_code == 202
```

```bash
cd ~/ruta/AGENT4U/backend
uv run pytest -q tests/api/test_cola_caida.py     # 2 failed, con ConnectionError
```

Los dos fallan con `ConnectionError: Redis no responde`: el `TestClient` re-lanza las excepciones no controladas del servidor en vez de devolver un 500. Pega el resumen en la entrega.

**6.2 El arreglo.** En `backend/app/api/routers/indexation.py`:

(a) Debajo de `REINTENTAR_EN = 120`, añade:

```python
REINTENTAR_TRAS_FALLO = 30
```

(b) En `RESPUESTAS_COMUNES`, debajo de la entrada `409`, añade la del 503 para que aparezca en `/docs`:

```python
    503: {
        "model": ErrorOut,
        "description": "No se pudo encolar (Redis caido). Reintentar tras Retry-After.",
    },
```

(c) En `_encolar_trabajo`, guarda el documento que devuelve `crear_documento_encolado` (cambia `document_crud.crear_documento_encolado(` por `doc = document_crud.crear_documento_encolado(`) y sustituye la línea `await cola.encolar(...)` por:

```python
    try:
        await cola.encolar(job_id, file_path=file_path, type=tipo, size=size)
    except Exception:
        # El trabajo no ha llegado a Redis. Si la fila se quedara, seria un
        # fantasma: 'en-cola' para siempre, ocupando cupo y bloqueando el
        # origen con 409. Se deshace la fila y se avisa de que se reintente.
        db.delete(doc)
        db.commit()
        raise HTTPException(
            status_code=503,
            detail="La cola de indexacion no esta disponible.",
            headers={"Retry-After": str(REINTENTAR_TRAS_FALLO)},
        )
```

Esto es una **compensación**: como no hay una transacción que abarque SQLite y Redis a la vez, si el segundo paso falla se deshace a mano el primero.

```bash
uv run pytest -q tests/api/test_cola_caida.py     # 2 passed
```

**6.3 El timeout, fijado con `xfail`.** Crea `backend/tests/integration/test_worker_timeout.py`:

```python
"""Que le pasa al documento si ARQ corta el job por job_timeout."""
import asyncio
import time
import uuid

import pytest

import app.worker.jobs as jobs
from app.db.crud import document as document_crud


@pytest.mark.xfail(strict=True, reason="Bug conocido: el timeout deja el documento en 'indexando'")
async def test_un_timeout_no_deja_el_documento_en_indexando(
    db, documentos_frescos, monkeypatch,
    converter, chunker, dense_embedder, sparse_embedder, qdrant,
):
    job_id = str(uuid.uuid4())
    document_crud.crear_documento_encolado(
        db, origen="/docs/lento.pdf", nombre="lento.pdf",
        tipo="pdf", tamano=1, job_id=job_id,
    )

    def normalizar_lento(**kwargs):
        time.sleep(0.5)          # Docling "tardando mas que job_timeout"
        return [], []

    monkeypatch.setattr(jobs, "normalize_text", normalizar_lento)
    monkeypatch.setattr(jobs, "embed_texts", lambda **kwargs: None)

    ctx = {
        "converter": converter, "chunker": chunker,
        "dense_embedder": dense_embedder, "sparse_embedder": sparse_embedder,
        "qdrant": qdrant,
    }

    # Lo mismo que hace ARQ con job_timeout: asyncio.wait_for cancela el job.
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(
            jobs.indexar_job(ctx, job_id, "/docs/lento.pdf", "pdf", 1), timeout=0.1,
        )

    assert documentos_frescos()[0].state != "indexando"
```

`xfail(strict=True)` significa: *"este test describe el comportamiento correcto y hoy falla a propósito"*. Si falla, la suite sigue en verde (`xfailed`). Si algún día alguien arregla el bug y el test pasa, `strict=True` lo convierte en un fallo (`XPASS(strict)`), y eso obliga a quitar la marca. Es la forma honesta de dejar un bug documentado dentro de la suite, en vez de en un comentario que nadie lee.

### Paso 7 — Validar y subir (2 min)

```bash
uv run pytest -q                  # 93 passed, 1 xfailed
uv run ruff check app tests       # All checks passed!
cd ..
git add backend/app/api/routers/indexation.py \
        backend/tests/api/test_cola_caida.py \
        backend/tests/integration/test_worker_timeout.py
git diff --cached --stat          # 3 ficheros, ni uno más
git commit -m "fix(indexacion): compensa la fila si falla el encolado (503); fija el bug del timeout con xfail"
git push -u origin ejercicio/dia-05
```

### Preguntas (responde con tus palabras en la entrega)

1. Cuenta el recorrido de `POST /indexar` desde que llega la petición hasta que `GET /trabajos/{id}` devuelve `indexado`: qué se escribe en SQLite y qué en Redis, en qué orden y qué proceso cambia cada estado.
2. Con la `PTTL` del Paso 3: ¿cuánto tiempo puede estar el worker parado antes de que un trabajo encolado se pierda? ¿Qué le pasa entonces a su fila en SQLite?
3. ¿Por qué el cupo se cuenta en SQLite y no con `ZCARD arq:queue`? Usa lo que viste en el Paso 5. Da una ventaja y un inconveniente de esa decisión.
4. `_encolar_trabajo` hace primero el `INSERT` y después `encolar`. Razona qué pasaría con el orden contrario (primero Redis, luego SQLite) si el segundo paso falla, mirando lo que hace `indexar_job` cuando `obtener_por_job_id` devuelve `None`. ¿Qué orden elegirías, con tu compensación del Paso 6 puesta?
5. Explica con tus palabras por qué el `except Exception` de `worker/jobs.py:59` no se ejecuta en un timeout de ARQ. ¿Por qué no basta con cambiarlo por `except BaseException` y marcar `error`? (Pista: ¿qué está haciendo todavía el hilo de `asyncio.to_thread`? ¿Y qué pasa con un `CancelledError` por un apagado ordenado, que ARQ sí reintenta?)
6. Hoy, en un único proceso de uvicorn, dos `POST /indexar` simultáneos no pueden saltarse el cupo. ¿Por qué? ¿Qué cambio concreto haría que sí pudieran? Relaciónalo con el día 04.
7. Con tu arreglo, si `/indexar-fichero` recibe un 503, el fichero subido se queda en `upload_dir`. ¿Lo borrarías ahí? Piensa en el bug del 409 (sección 3) antes de responder: ¿qué fichero borrarías si el `os.replace` ya pisó uno existente?

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-05` en el remoto, creada desde `main` (`git merge-base --is-ancestor origin/main origin/ejercicio/dia-05`).
- [ ] Paso 3: salidas pegadas, con cinco `202`, un `429` con `Retry-After: 120`, `ZCARD arq:queue` = 5 y la `PTTL` convertida a horas.
- [ ] Paso 4: trozo del log del worker y del sondeo hasta `indexado`; el sexto documento entra con `202`.
- [ ] Paso 5: `doc7` en `en-cola` tras el `FLUSHALL` y con el worker arrancado, reindexarlo da `409`, y el `DELETE` lo limpia.
- [ ] Paso 6.1: resumen de pytest con los 2 tests en rojo **antes** del arreglo.
- [ ] `_encolar_trabajo` responde 503 con `Retry-After: 30` y borra la fila si `encolar` falla; el 503 aparece en `RESPUESTAS_COMUNES`.
- [ ] `uv run pytest -q` → `93 passed, 1 xfailed` y `uv run ruff check app tests` limpio (pega los resúmenes).
- [ ] `git diff --stat origin/main origin/ejercicio/dia-05` muestra solo los 3 ficheros del Paso 7.
- [ ] Las 7 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

Entrega (antes de las 8:30 del **viernes 30-oct**):

```bash
git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-05.md
# ...rellena dia-05.md: salidas de los pasos 3-6, resúmenes de pytest y ruff, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-05.md
git commit -m "entrega día 05" && git push
```

Si quieres feedback antes de entregar, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code con `XX = 05`, estando en tu rama `ejercicio/dia-05`.

---

## 5. Para profundizar (opcional)

- ARQ, documentación oficial (trabajos, reintentos, `job_timeout`, `_job_id` y las claves en Redis): https://arq-docs.helpmanual.io/
- Python, `asyncio.wait_for` y cancelación de tareas (por qué `CancelledError` no es `Exception`): https://docs.python.org/3/library/asyncio-task.html#asyncio.wait_for

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la primera mitad de la sección *4. Ingesta asíncrona: cola, worker y vectorización* debería cubrir:

- El flujo `202` + sondeo: qué hace la API (cupo, fila `en-cola`, encolar), qué hace el worker (estados `indexando` → `indexado`/`error`, idempotencia con `borrar_por_origen`) y cómo se entera el cliente.
- Las dos fuentes de estado, Redis (transporte) y SQLite (verdad), y los caminos por los que hoy se desincronizan: fallo al encolar (arreglado por ti), timeout, worker muerto, Redis vaciado. Por qué haría falta un reconciliador.
- El puerto `ColaIndexacion` con sus dos adaptadores, y por qué el doble de tests no es fiel en `en_vuelo`.
- Por qué `max_jobs = 1` y cómo se escalaría.

**El viernes 30-oct (día 06):** abrimos la caja negra de `_trabajo`. Docling convierte el documento, el `HybridChunker` lo trocea con el tokenizador de e5, fastembed genera los vectores densos y BM25, y `embed_texts` los sube a Qdrant por lotes. Inspeccionarás en el dashboard de Qdrant los puntos que genera un documento y veremos qué lleva cada payload (y qué sobra).
