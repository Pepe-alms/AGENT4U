# Píldora 02 — Configuración tipada en los tres servicios

**Jueves 22-oct-2026 · ~1 h (20 min de lectura + 40 min de ejercicio)**

## 0. Crítica de la entrega del día 01

Has entregado `entregas/Ejercicio 1.md` en `origin/aprendizaje` (commit `e8afc4a`). Voy criterio por criterio, sin rodeos.

### Criterios de aceptación

- ❌ **`/health` y `/health/qdrant` probados con la salida pegada.** No hay salida de `/health`. Tu log de uvicorn termina en `Started reloader process [19943]` y nunca llega a `Application startup complete.`, así que no hay pruebas de que la API llegara a arrancar.
- ❌ **Caso "Qdrant caído" con su código HTTP.** El JSON que pegas (`"status": "unhealthy"`, `"services": {"qdrant": {"status": "down", ...}}`) **no lo puede producir este código**. `routers/health.py` devuelve `{"status": "error", "coleccion": ..., "existe": false, "detalle": ...}` y FastAPI lo filtra por `response_model=SaludQdrantOut`. Tampoco pegas el código HTTP. Esa salida no viene de tu API; lo más probable es que venga de un chat. No pasa nada por no llegar a terminar, pero una evidencia que no es real es peor que un "no me dio tiempo".
- ❌ **Tiempo de arranque anotado.** No aparece.
- ⚠️ **`grep` del Paso 4 y conclusión.** El `grep` está bien pegado, pero la conclusión es la contraria a lo que dice el `grep` (lo explico abajo).
- ❌ **Los 14 endpoints de `/docs`.** No aparecen.
- ⚠️ **Las 7 preguntas con tus palabras.** La 1 es el diagrama de la píldora copiado y recortado. Las 4, 6 y 7 suenan a texto generado: frases genéricas y cosas que no aplican a este repo (Elasticsearch, "base de datos" para Redis).
- ⚠️ **Párrafo para `ARCHITECTURE.md`.** Hay un párrafo, pero cuenta lo que has aprendido, no cómo es la arquitectura.

Detalles de forma: el fichero se llama `Ejercicio 1.md` en vez de `dia-01.md`, la cabecera sigue con `Entrega día XX — <tema>`, la rama que indicas (`ejercicio/dia-1`) no existe en el remoto y **borraste `PLANTILLA.md`** al renombrarla. Hoy la he restaurado. A partir de hoy, **copia** la plantilla (`cp`), no la muevas.

### Errores conceptuales, corregidos

**1. Pregunta 3: los objetos que sobran son los otros.** Dices que sobran `dense_embedder`, `sparse_embedder` y `qdrant`. Son justo los que **sí** se usan: `query.py` y el grafo los leen en cada pregunta, y sin `qdrant` no hay búsqueda. Tu propio `grep` da la respuesta correcta:

```
app/api/lifespan.py:50:    app.state.converter = DocumentConverter(
app/api/lifespan.py:59:    app.state.chunker = HybridChunker(tokenizer=tokenizer)
```

Lo que concluyes ("aparece definido en más de un sitio") no es lo que significa esa salida. Son **dos objetos distintos** en **el mismo fichero**, y son las únicas apariciones: ninguna línea los **lee** (`request.app.state.converter`). Por eso sobran: desde que la ingesta está en el worker, la API los carga y nadie los usa. Para saber si algo está muerto hay que buscar las **lecturas**, no las asignaciones.

**2. Pregunta 2: misma imagen para `api` y `worker`.** Tu respuesta ("se despliega todo a la par") no es la razón. La razón es que el worker **importa el mismo código** que la API: `app.services`, `app.rag.vectorization`, `app.db`, `app.core.config`. Con una sola imagen, el código y las versiones de dependencias de los dos procesos son idénticos por construcción, y solo mantienes un `Dockerfile` y un `uv.lock`. Los riesgos:
- Las dos imágenes pesan lo mismo: la API arrastra Docling aunque ya no lo use, y el worker arrastra FastAPI.
- Si reconstruyes uno y no el otro, pueden ejecutar versiones distintas del mismo código. Un trabajo encolado por una API nueva lo podría recoger un worker viejo.

**3. Pregunta 4: el porqué del 200.** No es que "la petición HTTP se procesó". Es la separación entre **liveness** (¿está vivo el proceso?) y **readiness o dependencias** (¿puede hacer su trabajo?). El coste que no mencionas: Docker y los balanceadores solo miran el código HTTP. Por eso el healthcheck de `api` usa `/health` y no `/health/qdrant`: si usara este, nunca detectaría un fallo.

**4. Pregunta 5: no la contestaste.** Pegas `QdrantClient("http://localhost:6333")`, que no es la pregunta. La respuesta, que hoy es justo nuestro tema: cada contenedor tiene su propia red, y dentro de él `localhost` es **el propio contenedor**. Compose registra un DNS interno donde el nombre del servicio (`qdrant`) es un nombre de host. El valor `http://localhost:6333` es el **defecto** de `config.py:8`, y `docker-compose.yml:29` lo **sobrescribe** con la variable `APP_QDRANT_URL: http://qdrant:6333`. En la sección 2 verás por qué gana la variable.

**5. Pregunta 6: la idea es correcta, los detalles no.**
- Redis no es "la base de datos": es el broker de la cola. La base de datos es SQLite.
- `api` espera a Redis *healthy* y a Qdrant solo *started* (`docker-compose.yml:44-48`). Te dejas la diferencia y también el `worker`.
- "El usuario nunca recibirá un 502" no es cierto. `depends_on` solo ordena **el arranque**: si la API se cae después, el gateway sigue vivo y responde con errores.

**6. Pregunta 7: BGE-M3.**
- "No necesitas Elasticsearch para BM25" no aplica: aquí **no hay Elasticsearch**. El vector BM25 ya vive en Qdrant, generado por fastembed (`Qdrant/bm25`).
- "Pierde el cross-encoder" también es incorrecto: el reranker es una etapa aparte, y con BGE-M3 se puede seguir usando uno, por ejemplo `bge-reranker`. La comparación es **un embedder frente a dos**.
- Lo que sí acertaste y es relevante: e5 tiene un límite de 512 tokens, y por eso el chunker usa `max_tokens=500`. BGE-M3 admite 8192.
- Faltan la RAM (un modelo en lugar de dos) y la licencia no comercial del reranker de Jina.

### Lo que has hecho bien, y es lo mejor de la entrega

En el mismo commit cambiaste `docker-compose.yml`, y **los dos cambios son buenos**:

1. **El healthcheck del gateway estaba roto, y lo has arreglado.** Lo he comprobado con Strawberry 0.336.2, la versión de `gateway/uv.lock`, y `urllib`:
   - `GET /graphql` sin `query` → **HTTP 400**.
   - `GET /graphql?query={__typename}` → **200**.

   Con el original, el gateway nunca pasaba a *healthy* y `docker compose --profile frontend up` no llegaba a levantar el frontend, porque depende de `gateway: service_healthy`. Es un bug real, el diagnóstico es correcto (`urllib` no envía `Accept: text/html`, así que Strawberry no sirve GraphiQL) y el comentario explica el porqué. Así se trabaja.
2. **`start_period: 10m` en la API**, con su comentario. Es correcto que "un margen largo no retrasa nada": durante el `start_period`, el primer chequeo que funciona marca *healthy* al momento. Dos matices:
   - Docker no "la da por muerta" ni la mata: la marca *unhealthy*, y es Compose quien se niega a arrancar el gateway.
   - El coste: si la API se cuelga al arrancar, tardarás hasta 10 min en enterarte.

**El problema es dónde lo hiciste.** Ese cambio está en la rama `aprendizaje`, que es solo para `docs/aprendizaje/`. Así no llega a `main` (o llegaría mezclado con la documentación en la PR final). Llévalo a una rama propia y abre una PR:

```bash
git fetch origin
git switch -c fix/healthchecks origin/main
git checkout origin/aprendizaje -- docker-compose.yml
git diff --cached                       # revisa que solo van tus dos cambios
git commit -m "fix(compose): healthcheck del gateway y start_period de la api"
git push -u origin fix/healthchecks     # y abre la PR contra main en GitHub
# después, deja aprendizaje como main en ese fichero:
git switch aprendizaje && git pull
git checkout origin/main -- docker-compose.yml
git commit -m "chore: docker-compose vuelve a main (va en fix/healthchecks)" && git push
```

### Qué te falta

Ejecutar de verdad y pegar lo que sale. Es lo que da valor a la entrega, y lo que me permite corregirte con precisión.

**Nota: 4/10.** Los fallos están en las evidencias y en la conclusión del Paso 4. Sube la nota el arreglo del healthcheck, que es trabajo de ingeniería de verdad.

---

## 1. Concepto clave: configuración tipada y "12-factor"

Una aplicación necesita valores que **cambian según dónde se ejecuta** (URL de Qdrant, clave del LLM, ruta de la base de datos) y que **no deben estar en el código**. La regla clásica (*The Twelve-Factor App*, factor III) es: **la configuración va en variables de entorno**. El mismo código y la misma imagen sirven en tu Mac, en Docker y en producción; solo cambia el entorno.

El problema de `os.getenv("X")` a pelo es que todo llega como `str | None`: nadie comprueba que `APP_INDEX_MAX_EN_COLA=abc` es un error hasta que algo explota a mitad de una petición. **pydantic-settings** lo resuelve: declaras una clase con tipos y valores por defecto, y al construirla:

1. Lee cada campo de varias **fuentes**, por orden de prioridad (de más a menos):
   1. Argumentos explícitos: `Settings(qdrant_url=...)`.
   2. **Variables de entorno** del proceso.
   3. El fichero **`.env`**, si está declarado con `env_file`.
   4. El **valor por defecto** de la clase.
2. **Convierte y valida**: `"4"` pasa a `4`, y `"abc"` en un `int` falla *al arrancar* con un `ValidationError` claro.
3. Si declaras `env_prefix="APP_"`, el campo `qdrant_url` se busca como `APP_QDRANT_URL`. No distingue mayúsculas: `app_qdrant_url` también vale.

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_")
    qdrant_url: str = "http://localhost:6333"   # defecto
    index_max_en_cola: int = 4                  # se valida como int

Settings().qdrant_url   # APP_QDRANT_URL del entorno > .env > defecto
```

**El frontend es otro mundo.** Un bundle de JavaScript se ejecuta en el **navegador del usuario**, no en tu servidor: allí no hay variables de entorno. Vite las resuelve **al construir**: sustituye literalmente `import.meta.env.VITE_API_URL` por su valor dentro del `.js`. Solo expone las que empiezan por `VITE_`, para que no se cuele en el bundle cualquier variable de tu shell (un `AWS_SECRET_ACCESS_KEY`, por ejemplo). Consecuencia: **todo lo que lleva `VITE_` es público**, porque cualquiera puede leerlo en el código fuente de la página.

---

## 2. Cómo está en AGENT4U

### 2.1 Backend — `backend/app/core/config.py`

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "Agent4U"
    gemini_api_key: str | None = None
    llm_model: str = "gemini/gemini-flash-lite-latest"
    db_url: str = "sqlite:///./agent4u.db"
    ...
    index_lote_upsert: int = 200

    @property
    def index_max_en_vuelo(self) -> int:
        return self.index_max_concurrentes + self.index_max_en_cola

@lru_cache()
def get_settings() -> Settings:
    return Settings()
```

- **14 campos** y una propiedad derivada. Están agrupados: conexiones (Qdrant, Redis, BD), LLM (`llm_model`, la lista blanca `llm_modelos`, `max_fragmentos_*`), subida (`upload_dir`, `upload_max_bytes`) e indexación (`index_*`).
- `env_file=".env"` es una ruta **relativa al directorio desde el que lanzas el proceso**. Si lo lanzas desde `backend/`, lee `backend/.env`. Si lo lanzas desde la raíz del repo, no encuentra nada y usa los valores por defecto sin avisar.
- `extra="ignore"`: si en el `.env` hay claves que no son campos (por ejemplo un `GEMINI_API_KEY` antiguo), no falla. Sin esta opción, pydantic rechazaría el `.env` con *"Extra inputs are not permitted"*.
- `index_max_en_vuelo` es una `@property`: no se lee del entorno, se **deriva**. El docstring explica por qué: `GET /ajustes` la expone al frontend para que el límite exista en un solo sitio.
- **`@lru_cache` convierte `get_settings()` en un singleton**: la primera llamada construye `Settings()` y las siguientes devuelven **el mismo objeto**. Se usa en 7 ficheros de `app/` (`lifespan.py`, `health.py`, `query.py`, `indexation.py`, `vectorization.py`, `db/session.py` y `worker/settings.py`).

Dos de esos usos leen la configuración **al importar el módulo**, no al llamar a una función:

```python
# app/rag/vectorization.py:7
COLLECTION_NAME = get_settings().qdrant_collection
# app/db/session.py:12-15
settings = get_settings()
engine = create_engine(settings.db_url, connect_args={"check_same_thread": False, "timeout": 30})
```

**Cómo llega cada valor en Docker.** La imagen **no** contiene ningún `.env`: el `backend/Dockerfile` solo copia `pyproject.toml`, `uv.lock` y `app/`. Todo llega por `environment:` en `docker-compose.yml:28-33`:

```yaml
    environment:
      APP_QDRANT_URL: http://qdrant:6333
      APP_DB_URL: sqlite:////data/agent4u.db        # 4 barras = ruta absoluta /data/...
      APP_REDIS_URL: redis://redis:6379
      APP_UPLOAD_DIR: /uploads
      APP_GEMINI_API_KEY: ${APP_GEMINI_API_KEY}
```

`${APP_GEMINI_API_KEY}` **no** sale de `backend/.env`. Compose lo *interpola* desde **tu shell** o desde un `.env` en la **raíz** del repo, que es el directorio del `docker-compose.yml`. Por eso en tu entrega salía `WARN The "APP_GEMINI_API_KEY" variable is not set`: tu clave estaba en `backend/.env`, que Compose no lee.

### 2.2 Gateway — `gateway/app/config.py`

```python
class Settings(BaseSettings):
    backend_url: str = "http://localhost:8000"
    model_config = {"env_prefix": "GATEWAY_"}
```

Tiene un solo campo, se lee en el `lifespan` de `gateway/app/main.py:16-20` y alimenta dos clientes HTTP: el de GraphQL (`HttpBackendClient`) y el del *passthrough* (`proxy_client`, con `timeout=None` porque el stream SSE puede durar). En Compose, `GATEWAY_BACKEND_URL: http://api:8000`.

Fíjate en que **no declara `env_file`**. Lo vemos en la sección 3.

### 2.3 Frontend — `VITE_API_URL`

Es la única variable, y se lee en **un solo sitio**: `frontend/src/shared/api/cliente.ts:17`.

```ts
const BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

function urlDe(ruta: string): string {
  if (!BASE_URL) throw new ErrorApi(MENSAJES.configuracion, 'configuracion');
  return `${BASE_URL}${ruta}`;
}
```

Tiene tres caminos, cada uno con su fuente:

| Comando | De dónde sale `VITE_API_URL` | Valor |
|---|---|---|
| `npm run dev` | `frontend/.env` (copia de `.env.example`, no versionado) | `http://localhost:8080`, el gateway |
| `npm run build` y Docker | `frontend/.env.production` (**versionado**) | `/api` (ruta relativa) |
| `npm run test:e2e` | `env:` en `playwright.config.ts:79` (variable de proceso, que gana a los ficheros) | el servidor falso |

En producción, nginx (`despliegue/nginx.conf:41-51`) recibe `/api/...` y lo reenvía a `http://gateway:8080/`. La barra final de `proxy_pass` quita el prefijo `/api`. Como frontend y API comparten origen, **no hace falta CORS**.

---

## 3. Por qué se montó así (y qué no cuadra)

### Decisiones

1. **pydantic-settings en lugar de `os.getenv`.** Tipos, valores por defecto documentados en un solo sitio y fallo **al arrancar** si un valor es inválido. Por ejemplo, `APP_INDEX_MAX_EN_COLA=abc` lanza `ValidationError: Input should be a valid integer` (lo he comprobado). La alternativa (`os.getenv` repartido por el código) es lo que había antes de `fb93eea`: `config.py` hacía `load_dotenv()` y `os.getenv("GEMINI_API_KEY")` al importarse. *Coste:* una dependencia más y la magia de las fuentes (hay que saber el orden de prioridad).

2. **Un prefijo por servicio (`APP_`, `GATEWAY_`).** El README lo recoge en la tabla de stack. Evita colisiones: nombres genéricos como `REDIS_URL` o `DB_URL` los usan también otras herramientas, y un `env` mezclado deja claro a quién pertenece cada variable. *Coste:* **tus** variables cumplen el prefijo, pero las librerías de terceros leen las **suyas** sin prefijo. Ese es el bug grande de hoy (lo vemos abajo).

3. **`lru_cache` en `get_settings()`.** Se parsea el entorno una vez y todos comparten el mismo objeto. Los tests lo aprovechan: `monkeypatch.setattr(get_settings(), "index_max_en_cola", 0)` (`tests/api/test_indexation.py:55-56`) funciona porque **todos los que llaman a `get_settings()` reciben ese mismo objeto**. *Coste:* un cambio en el entorno después de la primera llamada se ignora; hay que llamar a `get_settings.cache_clear()`. Y los módulos que leen al importar (`COLLECTION_NAME`, `engine`) ni siquiera se enteran del `monkeypatch`.

4. **La configuración de la build del frontend se versiona (`.env.production`) y es relativa.** El comentario de ese fichero cuenta el bug que lo motivó: `npm run build` metía en el bundle el `.env` local (`http://localhost:8000`) y "la aplicación publicada intentaba hablar con el portátil del que la compiló". *Coste* de la sustitución en tiempo de build: **una build por entorno**. Si mañana quieres la misma imagen en *staging* y en producción con URLs distintas, necesitarías configuración en ejecución, por ejemplo un `config.json` servido por nginx.

5. **El valor límite se deriva y se expone (`index_max_en_vuelo` en `/ajustes`)** en vez de repetirse en el frontend. Una sola fuente de verdad.

### Cosas que no cuadran (comprobadas hoy)

- 🔴 **La clave de Gemini no llega a LiteLLM.** Es un bug, no una opinión.
  - `Settings.gemini_api_key` **no se lee en ningún sitio**: `grep -rn gemini_api_key backend/app` solo devuelve su declaración.
  - Las 4 llamadas a `litellm.completion` (`rag/generation.py:13,22,30` y `rag/streaming.py:51`) no pasan `api_key`.
  - LiteLLM busca la clave en `os.environ["GEMINI_API_KEY"]` o `GOOGLE_API_KEY` (`litellm/llms/gemini/common_utils.py`), **sin prefijo**.
  - El commit `fb93eea` renombró la variable a `APP_GEMINI_API_KEY` y quitó el `load_dotenv()`. Lo he reproducido con litellm 1.96.0, la versión de `uv.lock`: con `APP_GEMINI_API_KEY=x` en el `.env`, `Settings` tiene la clave, pero `litellm.validate_environment("gemini/...")` responde `missing_keys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY']`.
  - **En Docker, `/preguntar` falla siempre por autenticación**, porque el contenedor solo recibe `APP_GEMINI_API_KEY`.
  - En tu Mac puede que te funcione **por casualidad**: si tu `backend/.env` es anterior y conserva la línea `GEMINI_API_KEY=` (en la píldora 01 copiaste con `cp -n`, que no sobrescribe), LiteLLM ejecuta su propio `load_dotenv()` al importarse (`litellm/__init__.py:26-27`) y la encuentra. Lo arreglas en el ejercicio.
- 🟠 **La documentación de la clave miente en dos sitios.**
  - `backend/.env.example:4-7` dice que es *"Obligatoria: sin esta variable Settings falla al construirse"*. Es falso desde `fb93eea`: el campo es `str | None = None`, y `Settings()` sin ningún `.env` se construye sin error (comprobado). Por la misma razón sobra el `APP_GEMINI_API_KEY: dummy-para-tests` del CI (`.github/workflows/backend.yml`).
  - La tabla *Variables de entorno* del `README.md` dice que la usa LiteLLM, y además solo lista 3 de las 14 variables.
- 🟠 **`gateway/.env` no sirve para nada.** El README del gateway y `gateway/.env.example` dicen `cp .env.example .env`, pero su `Settings` no declara `env_file`. Lo he comprobado: con `GATEWAY_BACKEND_URL=http://otra:9000` en un `.env`, `Settings()` sigue devolviendo `http://localhost:8000`. Solo funciona si exportas la variable en el shell.
- 🟡 **Comentarios desactualizados tras pasar por el gateway:**
  - `frontend/vite.config.ts` dice *"El backend solo permite CORS desde localhost:3000 y 5173 (backend/app/api/main.py:10)"*. Hoy el que importa es el CORS del **gateway** (`gateway/app/main.py:31-37`).
  - `cliente.ts:8` dice que nginx proxea `/api` *"al backend"*, cuando lo envía al gateway.
  - En `config.py`, el comentario de `index_max_en_cola` habla de *"llenar el threadpool de hilos bloqueados"*, que era el riesgo de antes de la cola en Redis.
- 🟡 **`APP_DB_URL` promete más de lo que da.** `db/session.py:16` pasa `check_same_thread`, que **solo existe en SQLite**, sin mirar el motor. Si apuntas `APP_DB_URL` a PostgreSQL, `create_engine` falla. La variable sugiere que puedes cambiar de base de datos, y el código no lo permite.
- 🟡 **Sin secretos tipados.** Lo idiomático sería `gemini_api_key: SecretStr | None`, para que la clave no salga en claro en un `print(settings)` o en un log. Hoy sale en claro.

---

## 4. Ejercicio (≈40 min)

**Rama de código:** `ejercicio/dia-02`, creada desde `main`. Hoy sí hay código: arreglas el bug de la clave y añades una variable nueva.

### Paso 1 — Seguir una variable por sus 4 fuentes (8 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin && git switch -c ejercicio/dia-02 origin/main
cd backend
# a) el defecto, o lo que ponga tu .env
uv run python -c "from app.core.config import get_settings as g; print(g().qdrant_url)"
# b) una variable de proceso gana al .env
APP_QDRANT_URL=http://desde-shell:6333 uv run python -c "from app.core.config import get_settings as g; print(g().qdrant_url)"
# c) el tipo se valida al construir
APP_INDEX_MAX_EN_COLA=abc uv run python -c "from app.core.config import get_settings as g; g()"
# d) lo que ve el contenedor: Compose ya interpolado
cd .. && docker compose config | grep -n "APP_\|GATEWAY_"
APP_GEMINI_API_KEY=prueba docker compose config | grep -n GEMINI
```

Pega las 5 salidas en la entrega.

### Paso 2 — Ver el secreto en el bundle del frontend (5 min)

```bash
cd frontend
npm install                     # si no lo tienes ya
VITE_API_URL=http://SECRETO-FALSO npm run build
grep -o "SECRETO-FALSO" dist/assets/*.js | head -3
npm run build                   # sin la variable: usa .env.production
grep -o '.\{0,15\}/api.\{0,10\}' dist/assets/*.js | head -3
cd ..
```

### Paso 3 — Reproducir el bug de la clave (5 min)

```bash
cd backend
grep -n "GEMINI" .env           # ¿tienes APP_GEMINI_API_KEY, GEMINI_API_KEY o las dos?
grep -rn "gemini_api_key" app/  # ¿alguien la lee?
APP_GEMINI_API_KEY=x uv run python -c "
import os, litellm
os.environ.pop('GEMINI_API_KEY', None)   # simula el contenedor
from app.core.config import get_settings
print('Settings tiene clave:', bool(get_settings().gemini_api_key))
print(litellm.validate_environment('gemini/gemini-flash-lite-latest'))"
```

Esperado: `Settings tiene clave: True` y `missing_keys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY']`.

### Paso 4 — Arreglarlo: la clave viaja explícita (10 min)

En `backend/app/rag/generation.py`, importa la configuración y pasa `api_key` en las **3** llamadas:

```python
from app.core.config import get_settings

def reescribir_consulta(consulta: str, model: str) -> str:
    respuesta = litellm.completion(
        model=model,
        messages=prompt_reescribir(consulta),
        api_key=get_settings().gemini_api_key,
    )
    ...
```

Haz lo mismo en `reformular_consulta` y `descomponer_consulta`, y en `backend/app/rag/streaming.py:51` (añade el import arriba):

```python
            stream = litellm.completion(
                model=model,
                messages=messages,
                stream=True,
                api_key=get_settings().gemini_api_key,
            )
```

Si `gemini_api_key` es `None`, LiteLLM vuelve a buscar en el entorno, así que no rompes a quien aún use `GEMINI_API_KEY`.

Crea `backend/tests/integration/test_generation.py`:

```python
"""La clave de APP_GEMINI_API_KEY tiene que llegar a litellm."""
from types import SimpleNamespace

import app.rag.generation as generation
from app.core.config import get_settings


def _respuesta(texto: str):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=texto))]
    )


def test_reescribir_pasa_la_clave_de_settings(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "clave-de-test")
    recibido = {}

    def completion_falso(**kwargs):
        recibido.update(kwargs)
        return _respuesta("  consulta reescrita  ")

    monkeypatch.setattr(generation.litellm, "completion", completion_falso)

    assert generation.reescribir_consulta("hola", model="gemini/x") == "consulta reescrita"
    assert recibido["api_key"] == "clave-de-test"
```

Y corrige la mentira de `backend/.env.example:4-6`: escribe tú qué pasa de verdad si la variable falta (la app arranca, y lo que falla es `/preguntar`).

### Paso 5 — Una variable nueva: `APP_INDEX_REINTENTAR_EN` (10 min)

Hoy el `Retry-After` del 429 es una constante (`routers/indexation.py:24`, `REINTENTAR_EN = 120`). Conviértelo en configuración.

1. En `backend/app/core/config.py`, debajo de `index_lote_upsert`:

   ```python
       # Segundos que se sugieren en la cabecera Retry-After cuando la cola de
       # indexacion esta llena (429).
       index_reintentar_en: int = 120
   ```

2. En `backend/app/api/routers/indexation.py`, borra `REINTENTAR_EN = 120` y en `_comprobar_cupo` usa:

   ```python
               headers={"Retry-After": str(get_settings().index_reintentar_en)},
   ```

3. Documéntala en `backend/.env.example`, dentro del bloque `# --- Indexacion ---`:

   ```bash
   # Segundos que se sugieren en Retry-After cuando se responde 429.
   # APP_INDEX_REINTENTAR_EN=120
   ```

4. Añade al final de `backend/tests/api/test_indexation.py`:

   ```python
   def test_retry_after_sale_de_la_configuracion(client, monkeypatch):
       monkeypatch.setattr(get_settings(), "index_max_concurrentes", 0)
       monkeypatch.setattr(get_settings(), "index_max_en_cola", 0)
       monkeypatch.setattr(get_settings(), "index_reintentar_en", 30)

       respuesta = client.post("/indexar", json=CUERPO)

       assert respuesta.status_code == 429
       assert respuesta.headers["retry-after"] == "30"
   ```

5. Crea `backend/tests/unit/test_config.py`, que prueba la lectura del entorno **sin** la caché:

   ```python
   from app.core.config import Settings


   def test_reintentar_en_se_lee_del_entorno(monkeypatch):
       monkeypatch.setenv("APP_INDEX_REINTENTAR_EN", "45")
       assert Settings(_env_file=None).index_reintentar_en == 45
   ```

6. Ejecuta la suite y el linter, y sube la rama:

   ```bash
   cd backend
   uv run pytest -q
   uv run ruff check app tests
   grep -rn "REINTENTAR_EN" app/ tests/     # no debe quedar ninguna
   git add -A && git commit -m "fix(config): clave de Gemini explícita y APP_INDEX_REINTENTAR_EN"
   git push -u origin ejercicio/dia-02
   ```

### Paso 6 — Responde en `entregas/dia-02.md` (copia `entregas/PLANTILLA.md`)

1. Ordena las 4 fuentes de pydantic-settings de más a menos prioridad y demuéstralo con tus salidas del Paso 1.
2. ¿Por qué `docker compose config` muestra `APP_QDRANT_URL: http://qdrant:6333` aunque tu `backend/.env` diga otra cosa? ¿Y de dónde sale `${APP_GEMINI_API_KEY}`?
3. Explica con tus palabras por qué la clave no llegaba a LiteLLM, y por qué a ti en local quizá sí te funcionaba. Pega lo que te devolvió el `grep -n GEMINI .env`.
4. `monkeypatch.setattr(get_settings(), "index_reintentar_en", 30)` funciona en el test de API. ¿Por qué? ¿Funcionaría igual con `qdrant_collection` para cambiar la colección que usa `vectorization.py`? Razónalo con el código.
5. ¿Por qué en `test_config.py` uso `Settings(_env_file=None)` y no `get_settings()`?
6. ¿Qué pasa si alguien pone `APP_INDEX_REINTENTAR_EN=-5`? ¿Cómo lo impedirías con pydantic? (Pista: `Field(gt=0)` o `PositiveInt`.) No hace falta que lo implementes.
7. Tras el Paso 2, ¿por qué no puede ir **nunca** un secreto en una variable `VITE_`? ¿Dónde tiene que vivir la clave de Gemini y por qué el navegador no la necesita?
8. Has arreglado la clave pasándola **explícita** en cada llamada. La alternativa era copiarla una sola vez a `os.environ["GEMINI_API_KEY"]` en el `lifespan`. Da un argumento a favor y otro en contra de cada opción.

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-02` en el remoto, creada desde `main`.
- [ ] Las 5 salidas del Paso 1 y la del `grep` del Paso 2 pegadas tal cual (salidas **reales**).
- [ ] Salida del Paso 3 antes del arreglo, con `missing_keys`.
- [ ] Las 4 llamadas a `litellm.completion` pasan `api_key`: `grep -c "api_key=get_settings().gemini_api_key" app/rag/*.py` da 3 en `generation.py` y 1 en `streaming.py`.
- [ ] `test_generation.py`, `test_config.py` y el test nuevo de `test_indexation.py` existen y pasan.
- [ ] `grep -rn "REINTENTAR_EN" backend/app backend/tests` no devuelve nada.
- [ ] `uv run pytest -q` en verde y `uv run ruff check app tests` sin errores (pega el resumen final de pytest).
- [ ] `.env.example` documenta `APP_INDEX_REINTENTAR_EN` y ya no dice que la clave sea obligatoria para construir `Settings`.
- [ ] Las 8 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

Entrega (antes de las 8:30 del **sábado 24-oct**; desde hoy las píldoras van en días alternos):

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-02.md
# ...rellénala...
git add docs/aprendizaje/entregas/dia-02.md
git commit -m "entrega día 02" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code con `XX = 02`.

---

## 5. Para profundizar (opcional)

- pydantic-settings, fuentes y prioridad: https://docs.pydantic.dev/latest/concepts/pydantic_settings/
- Vite, variables de entorno y modos: https://vite.dev/guide/env-and-mode

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la sección *2. Configuración* debería cubrir:
- Dónde vive la configuración de cada servicio: `Settings` con `APP_`, `Settings` con `GATEWAY_` y `VITE_API_URL`.
- El orden de prioridad de las fuentes y cómo llega cada valor en local y en Docker.
- La regla de los secretos: solo en backend, nunca en `VITE_`.
- La trampa de hoy: las librerías de terceros leen sus propias variables, sin tu prefijo.

Y aprovecha para escribir también el párrafo del día 01 que faltó, la sección *1. Visión general*: servicios, almacenes, qué se carga al arrancar y orden de arranque.

**El sábado 24-oct (día 03):** contratos de la API con Pydantic. Abrimos `app/api/schemas.py` y `core/exceptions.py`. Vas a predecir **antes de llamar** el JSON exacto de tres endpoints (incluido `/health/qdrant` con Qdrant caído, esta vez de verdad) y veremos cómo `response_model` filtra lo que sale de la API.
