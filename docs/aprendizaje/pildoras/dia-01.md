# Píldora 01 — Mapa global: los 6 servicios, el arranque y `lifespan`

**Miércoles 21-oct-2026 · ~1 h (20 min de lectura + 40 min de ejercicio)**

## 0. Crítica de la entrega anterior

Es el primer día, así que no hay entrega previa. A partir de mañana esta sección revisa tu `entregas/dia-XX.md`.

> **Aviso:** esta mañana (11:17) entró en `main` el commit `fb93eea` ("Chore/limpieza ficheros #38"). Cambió la arquitectura:
> - Añadió **Redis + un worker ARQ** y un **gateway GraphQL**.
> - Borró `CLAUDE.md`, `docs/DIARIO_DESARROLLO.md` y `frontend/.agent/`.
>
> El plan y esta píldora ya están ajustados a ese commit. El análisis se hace siempre sobre `main` tal como está.

---

## 1. Concepto clave: qué piezas hay y quién habla con quién

AGENT4U ya no es "una API y un front". Son **6 servicios** en `docker-compose.yml`:

```
                      ┌──────────── GraphQL (queries/mutations) ───────────┐
 Navegador ──────────▶│ gateway  :8080  (Strawberry + FastAPI)             │
 (frontend React)     │   └─ passthrough: SSE /preguntar, multipart fichero │
                      └──────────────────────┬─────────────────────────────┘
                                             │ HTTP
                                             ▼
                      ┌──────────── api :8000 (FastAPI) ───────────────────┐
                      │  /preguntar → grafo LangGraph → Qdrant + Gemini     │
                      │  /indexar*  → ENCOLA en Redis y responde 202        │
                      └───────┬───────────────┬──────────────┬─────────────┘
                              │               │              │
                        Qdrant :6333     Redis :6379      SQLite (volumen api_data)
                         (vectores)     (cola ARQ)        (documentos, conversaciones)
                              ▲               │              ▲
                              │               ▼              │
                              └──────── worker (ARQ) ────────┘
                                 Docling + fastembed: indexa en segundo plano

 frontend :3000 (nginx, build de producción) → solo con --profile frontend
```

| Servicio | Qué es | Imagen o build |
|---|---|---|
| `qdrant` | Base de datos vectorial: guarda y busca fragmentos por similitud | `qdrant/qdrant:v1.19.0` |
| `redis` | Broker de la cola de trabajos de indexación | `redis:7-alpine` |
| `api` | El backend: consulta RAG, gestión y encolado de indexaciones | `./backend` |
| `worker` | Proceso que **ejecuta** las indexaciones encoladas | `./backend` (misma imagen, otro `command`) |
| `gateway` | La única puerta del frontend: traduce GraphQL a REST contra `api` | `./gateway` |
| `frontend` | El build estático servido por nginx (para desarrollo se usa `npm run dev`) | `./frontend`, perfil `frontend` |

**Regla de oro:** el navegador **solo** habla con el `gateway`. Nunca habla con `api`, Qdrant ni Redis.

### El concepto que hay que dominar hoy: el `lifespan`

Una API atiende miles de peticiones. Hay objetos que **no puedes crear en cada petición**, como un modelo de embeddings, que ocupa cientos de MB y tarda segundos en cargar.

FastAPI lo resuelve con el **lifespan**: una función que se ejecuta **una vez al arrancar** y **una vez al apagar**.

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- ARRANQUE: 1 vez, antes de aceptar ninguna petición ---
    app.state.algo_caro = cargar()
    yield                      # ← aquí la app vive y atiende peticiones
    # --- APAGADO: 1 vez, al parar (Ctrl+C, docker stop) ---
    app.state.algo_caro.close()
```

`app.state` es un cajón compartido. Lo que metes en el arranque lo recupera cualquier endpoint con `request.app.state.algo_caro`.

El **worker** tiene su propio equivalente: `startup(ctx)` en `backend/app/worker/settings.py`. Carga los modelos en `ctx`, que ARQ pasa a cada trabajo. Es el mismo patrón en otro proceso.

---

## 2. Cómo está en AGENT4U

### 2.1 El punto de entrada — `backend/app/api/main.py`

```python
app = FastAPI(lifespan=lifespan)          # engancha arranque/apagado
app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"], ...)
app.include_router(health.router)         # /health, /health/qdrant
app.include_router(query.router)          # /ajustes, /preguntar
app.include_router(indexation.router)     # /indexar, /indexar-url, /indexar-fichero
app.include_router(jobs.router)           # /trabajos/{job_id}
app.include_router(documents.router)      # /documentos
app.include_router(conversations.router)  # /conversaciones
```

`main.py` solo **ensambla**: no contiene lógica de negocio. Cada fichero de `routers/` es un grupo de endpoints.

### 2.2 El arranque de la API — `backend/app/api/lifespan.py`

| Objeto en `app.state` | Qué es | ¿Lo usa algún endpoint hoy? |
|---|---|---|
| `dense_embedder` | `TextEmbedding("intfloat/multilingual-e5-large")`: texto → vector de 1024 números (significado) | Sí, `query.py` y el grafo |
| `sparse_embedder` | `SparseTextEmbedding("Qdrant/bm25", "spanish")`: vector léxico que premia palabras raras | Sí, `query.py` y el grafo |
| `cross_encoder` | `TextCrossEncoder("jinaai/jina-reranker-v2-base-multilingual")`: reordena candidatos | Sí, `query.py` y el grafo |
| `qdrant` | `QdrantClient(url=settings.qdrant_url)` | Sí |
| `converter` | `DocumentConverter` de Docling (PDF sin OCR, con tablas) | **No** (ver §3) |
| `chunker` | `HybridChunker` con el tokenizador de e5, `max_tokens=500` | **No** (ver §3) |
| `cola` | `ColaArq(settings.redis_url)`: conexión a la cola en Redis | Sí, `indexation.py` |
| `grafo` | `crear_grafo(...)`: el agente de LangGraph | Sí, `/preguntar` |

Además, `crear_esquema()` crea las tablas de SQLite si no existen.

Tras el `yield` se cierran la `cola` (con `await`, porque es asíncrona) y `qdrant`.

### 2.3 Las sondas de salud — `routers/health.py` + `docker-compose.yml`

- `GET /health` devuelve `{"status":"ok"}` **sin tocar nada**. Responde a "¿el proceso está vivo?".
- `GET /health/qdrant` pregunta a Qdrant si existe la colección. **Devuelve 200 aunque Qdrant esté caído**, con `status: "error"` en el cuerpo.
- `docker-compose.yml` usa `/health` como **healthcheck** del contenedor `api`. El `gateway` declara `depends_on: api: condition: service_healthy`: no arranca hasta que la API responde a `/health`. A su vez, `api` y `worker` esperan a que Redis esté *healthy* (`redis-cli ping`).

### 2.4 Contenedores

- **`api` y `worker` comparten imagen** (`build: ./backend`). Solo cambia el `command`: uvicorn en un caso y `python -m app.worker` en el otro. También comparten volúmenes:
  - `api_data`: el SQLite.
  - `uploads_data`: los ficheros subidos. El worker los lee después.
  - `model_cache`: la caché de Hugging Face, con `HF_HOME=/models/hf`.
- Dentro de la red de Docker, **el nombre del servicio funciona como nombre de host**: `http://qdrant:6333`, `redis://redis:6379`, `http://api:8000`.
- El `Dockerfile` instala con `uv sync --frozen --no-dev`: exactamente lo que fija `uv.lock` y sin herramientas de desarrollo.

---

## 3. Por qué se montó así (y qué no cuadra)

1. **Los modelos se cargan en el `lifespan` y no en cada petición.**
   - *Alternativa:* cargarlos por petición, lo que añadiría segundos a cada pregunta, o cargarlos de forma perezosa, lo que haría que el primer usuario se comiera la espera.
   - *Coste:* el arranque es lento (la primera vez descarga varios GB) y se ocupa RAM aunque nadie use la API.

2. **La indexación se sacó a un worker con cola.** Antes, `/indexar` procesaba el documento dentro de la petición HTTP. Docling sobre un PDF grande tarda minutos, así que bloqueaba un hilo y el cliente esperaba colgado.
   - Ahora la API **encola y responde `202`**, y el frontend sondea `GET /trabajos/{job_id}`.
   - Los comentarios de `config.py` explican los límites: `index_max_concurrentes=1` (Docling y ONNX ya usan todos los núcleos) e `index_max_en_cola=4`. Por encima de esa cifra se responde `429` para no agotar la memoria.
   - La API no habla con ARQ directamente, sino con un **puerto**: el `Protocol ColaIndexacion` de `cola_port.py`. Lo verás a fondo el día 05; es el patrón *puertos y adaptadores*.

3. **El gateway GraphQL hace de BFF** (*Backend for Frontend*). El frontend tiene un único interlocutor y un esquema tipado que puede pedir exactamente los campos que necesita. El coste es un salto de red más y otro servicio que mantener. Lo verás el día 11.

4. **`/health/qdrant` devuelve 200 aunque Qdrant falle** para distinguir *"el backend está caído"* de *"el backend está vivo pero su dependencia falla"*. Es la separación clásica entre **liveness** y **readiness o dependencias**.

5. **Búsqueda híbrida: dense + sparse + reranker, con tres modelos separados.**
   - e5-large para el vector denso; el README lo justifica en *Decisiones de diseño*.
   - BM25 para el vector disperso léxico.
   - El reranker de Jina.

   La alternativa obvia era **BGE-M3**, un solo modelo que da vector denso y disperso a la vez: menos RAM y un solo modelo que mantener. A cambio pierdes flexibilidad: no puedes cambiar una pieza sin cambiar las otras. Lo desmontamos el día 07.

### Cosas que no cuadran, detectadas hoy (las retomamos el día 21)

- **La API carga `converter` y `chunker` y ya no los usa.** Tras mover la ingesta al worker, ningún endpoint lee `app.state.converter` ni `app.state.chunker`. Docling carga modelos de layout y tablas, así que es RAM y tiempo de arranque desperdiciados. Compruébalo tú en el ejercicio.
- **El README afirma algo engañoso.** Dice que *"Backend y worker comparten el mismo embedder"*. Comparten **el mismo modelo** (e5-large), pero cada proceso carga **su propia copia** en memoria: son dos procesos y dos contenedores. En RAM, e5 está **dos veces**.
- **Licencia del reranker:** `jina-reranker-v2-base-multilingual` es **CC-BY-NC-4.0**, solo para uso no comercial. Está en el camino de cada consulta.
- **CORS en la API:** el frontend ya no llama a la API, llama al gateway. La lista de orígenes de `main.py` hoy solo importa si algo llama a la API directamente. El propio README lo anota como deuda.

---

## 4. Ejercicio (≈40 min)

**Rama de código:** `ejercicio/dia-01`, creada desde `main` (primero `git pull` para traer el commit de esta mañana). Hoy apenas hay código, así que puedes trabajar directamente en `main` sin commitear nada.

### Paso 1 — Levantar las dependencias: Qdrant y Redis

```bash
cd ~/ruta/AGENT4U
git checkout main && git pull
git checkout -b ejercicio/dia-01
docker compose up -d qdrant redis
docker compose ps                     # qdrant "running", redis "healthy"
open http://localhost:6333/dashboard
```

### Paso 2 — Arrancar la API en local y cronometrar el arranque

```bash
cd backend
cp -n .env.example .env               # -n: no machaca un .env existente
# edita .env → APP_GEMINI_API_KEY=tu_clave   (OJO: ahora lleva prefijo APP_)
uv sync
time uv run uvicorn app.api.main:app --reload
```

Espera a `Application startup complete.` y anota el tiempo. La primera vez descarga modelos y puede tardar varios minutos.

### Paso 3 — Probar las sondas

En otra terminal:

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
curl -s -i http://localhost:8000/health/qdrant

docker compose stop qdrant
curl -s -i http://localhost:8000/health/qdrant      # ¿código HTTP? ¿cuerpo?
docker compose start qdrant
```

### Paso 4 — Comprobar la afirmación de los modelos que sobran

```bash
cd backend
grep -rn "state.converter\|state.chunker" app/
```

¿Dónde aparecen? ¿Algún endpoint los **lee**? Haz lo mismo con `state.cross_encoder` y compara.

### Paso 5 — Explorar la API autodocumentada

Abre `http://localhost:8000/docs` y lista los endpoints agrupados por su *tag*.

### Paso 6 — Responde en `entregas/dia-01.md` (copia `entregas/PLANTILLA.md`)

1. Dibuja (en ASCII o Mermaid) los 6 servicios y quién habla con quién, **sin mirar la píldora**. Después compáralo y corrige.
2. ¿Por qué `api` y `worker` usan la misma imagen? ¿Qué ganas y qué riesgo introduce?
3. Enumera los objetos que el `lifespan` mete en `app.state` y di para qué sirve cada uno, en una frase tuya. Marca los que sobran y pega la evidencia del Paso 4.
4. Pega la salida de `/health/qdrant` con Qdrant caído. ¿Por qué 200? ¿Te parece buena decisión? Argumenta.
5. ¿Por qué dentro de Docker la URL de Qdrant es `http://qdrant:6333` y en tu Mac `http://localhost:6333`? ¿De dónde sale cada valor (`docker-compose.yml` frente a `config.py`)?
6. ¿Qué hace `depends_on: condition: service_healthy` y qué cadena de arranque provoca entre `redis`, `api` y `gateway`?
7. Compara **BGE-M3** (un modelo para denso y disperso) con lo que hay, **e5 + BM25 + reranker**. ¿Qué gana y qué pierde cada opción? Fuente: *Decisiones de diseño* del `README.md` y tu propio razonamiento.

**Bonus (opcional):** `docker compose up --build` con todo dentro de Docker.
- El healthcheck de `api` tiene `start_period: 15s` y 3 reintentos cada 10 s. Si en frío la API tarda varios minutos en cargar modelos, ¿qué le pasa al `gateway`? Compruébalo, no lo supongas.
- Repite con `model_cache` ya poblado y compara.

### Criterios de aceptación

- [ ] `/health` y `/health/qdrant` probados, con la salida pegada.
- [ ] Caso "Qdrant caído" documentado con su código HTTP.
- [ ] Tiempo de arranque anotado.
- [ ] Evidencia del `grep` del Paso 4 y conclusión sobre `converter` y `chunker`.
- [ ] Lista de endpoints de `/docs` completa: deben salir **14** operaciones.
- [ ] Las 7 preguntas respondidas con tus palabras. Lo copiado de la píldora se detecta en la crítica.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

Entrega (antes de las 8:30 de mañana):

```bash
git fetch origin && git switch aprendizaje        # la rama de esta carpeta
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-01.md
# ...rellénala...
git add docs/aprendizaje/entregas/dia-01.md
git commit -m "entrega día 01" && git push
```

Si quieres feedback antes, usa `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code.

---

## 5. Para profundizar (opcional)

- FastAPI, *Lifespan Events*: https://fastapi.tiangolo.com/advanced/events/
- Docker Compose, orden de arranque y healthchecks: https://docs.docker.com/compose/how-tos/startup-order/

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo de hoy debería cubrir tres cosas: qué servicios y almacenes hay y quién habla con quién, qué se carga al arrancar (en la API y en el worker) y por qué, y cómo se comprueba la salud del sistema y en qué orden arranca.

**Mañana (día 02):** configuración tipada en los tres servicios. Seguiremos una variable desde el `.env` hasta el código en backend (`APP_`), gateway (`GATEWAY_`) y frontend (`VITE_`), y veremos por qué en el frontend **nunca** puede ir un secreto.
