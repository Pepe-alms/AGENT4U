# Agent4U

> Sistema RAG (Retrieval-Augmented Generation) en español: ingesta estructurada de documentos, recuperación densa sobre Qdrant y generación de respuestas citadas — con un arnés de evaluación propio para medir la calidad del pipeline en cada cambio.

![Python](https://img.shields.io/badge/python-3.12+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)
![Qdrant](https://img.shields.io/badge/vector%20db-Qdrant-DC244C?logo=qdrant&logoColor=white)
![uv](https://img.shields.io/badge/deps-uv-261230)
![Estado](https://img.shields.io/badge/estado-en%20desarrollo-yellow)

## Visión general

Agent4U recibe documentos (PDF/DOCX), los convierte en fragmentos con estructura semántica, los indexa en una base vectorial y responde preguntas en lenguaje natural citando la fuente exacta de cada afirmación. El objetivo del proyecto es doble: servir como un RAG realmente usable sobre documentación propia, y como banco de pruebas para decisiones de diseño de RAG (chunking, embeddings, distancia de similitud, evaluación) documentadas y medidas, no solo intuidas.

El proyecto tiene dos mitades: un backend FastAPI + Qdrant y un frontend React + Vite que sirve a la vez un sitio editorial sobre el sistema (`/`) y la aplicación del agente (`/app`). Este README describe honestamente qué está implementado, qué está a medias y qué no está: es la única documentación del proyecto.

## Índice

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Stack tecnológico](#stack-tecnológico)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Puesta en marcha](#puesta-en-marcha)
- [Variables de entorno](#variables-de-entorno)
- [Uso de la API](#uso-de-la-api)
- [Cómo funciona el pipeline](#cómo-funciona-el-pipeline)
- [Evaluación del sistema](#evaluación-del-sistema)
- [Calidad y desarrollo](#calidad-y-desarrollo)
- [Flujo de trabajo con Git](#flujo-de-trabajo-con-git)
- [Roadmap y traza de mejoras](#roadmap-y-traza-de-mejoras)
- [Licencia](#licencia)

## Características

- **Ingesta estructurada de PDF/DOCX** con [Docling](https://docling-project.github.io/docling/): conserva títulos, secciones y tablas en lugar de extraer texto plano sin orden de lectura.
- **Chunking semántico** vía `HybridChunker`, atado al mismo tokenizer que el modelo de embeddings — evita fragmentos que rompan el límite de tokens del modelo.
- **Filtrado de ruido**: descarta chunks que son solo cabecera/pie de página o demasiado cortos para aportar contexto.
- **Recuperación densa multilingüe** (`multilingual-e5-large`, 1024 dimensiones) sobre Qdrant con distancia coseno.
- **Payload enriquecido por chunk**: documento de origen, páginas, encabezados y fecha de indexación — necesario para citar fuentes con precisión.
- **Ingesta idempotente**: los IDs son deterministas (`uuid5` sobre el texto del chunk), así que reindexar el mismo documento no duplica datos.
- **Generación con citas obligatorias** vía [LiteLLM](https://docs.litellm.ai/) (Gemini Flash Lite por defecto, intercambiable por otro proveedor sin tocar código) y un system prompt que fuerza a no alucinar fuera del contexto recuperado.
- **Arnés de evaluación end-to-end propio**: 25 preguntas fijas de 5 tipos distintos, contra un corpus de prueba de 11 documentos, con informes HTML/CSV por corrida (ver [Evaluación del sistema](#evaluación-del-sistema)).

## Arquitectura

```mermaid
flowchart LR
    subgraph ING["Ingesta - POST /indexar"]
        A["PDF / DOCX"] --> B["DocumentConverter (Docling)"]
        B --> C["HybridChunker + tokenizer e5-large"]
        C --> D["Filtro de ruido y longitud minima"]
        D --> E["fastembed: multilingual-e5-large"]
        E --> F[("Qdrant - coleccion Test_1")]
    end

    subgraph CONS["Consulta - POST /preguntar"]
        G["Pregunta del usuario"] --> H["fastembed: query embedding"]
        H --> I["Qdrant query_points (top-k)"]
        F -.-> I
        I --> J["Chunks + payload (doc, pagina, score)"]
        J --> K["Construccion de contexto con citas"]
        K --> L["LiteLLM -> Gemini Flash Lite"]
        L --> M["Respuesta con citas [documento]"]
    end
```

Ambos flujos comparten el mismo embedder (`fastembed`) y la misma colección de Qdrant, cargados una sola vez en el `lifespan` de FastAPI (`app/api/lifespan.py`) para no pagar el coste de inicialización en cada petición.

## Stack tecnológico

| Área | Tecnología | Estado |
|---|---|---|
| Backend / API | Python 3.12 + FastAPI (uvicorn) | Hecho |
| Gestión de dependencias | uv | Hecho |
| Ingesta / parsing | Docling — PDF/DOCX con estructura | Hecho |
| Ingesta / parsing | Trafilatura — limpieza de HTML desde URLs | Planificado |
| Chunking | Docling `HybridChunker` + tokenizer de e5-large | Hecho |
| Embeddings densos | fastembed — `intfloat/multilingual-e5-large` (1024 dim) | Hecho |
| Embeddings dispersos | fastembed — `Qdrant/bm25` | Hecho, integrados en la búsqueda |
| Base vectorial | Qdrant (dense, distancia coseno) | Hecho |
| Recuperación | Híbrida (dense + sparse con RRF) + reordenado con cross-encoder | Hecho |
| Generación | LiteLLM, por defecto `gemini/gemini-flash-lite-latest` | Hecho |
| Generación | Streaming de respuesta por SSE | Planificado — hoy `/preguntar` devuelve JSON bloqueante |
| Orquestación agéntica | LangGraph | Planificado — dependencia aún no añadida |
| Validación / config | Pydantic v2 + pydantic-settings | Hecho |
| Frontend | React + Vite + TypeScript | Planificado — carpeta `frontend/` reservada, sin scaffold |
| Contenedores | Docker Compose | Parcial — solo el servicio de Qdrant |
| Lint / tipado | `ruff` en verde; `mypy` configurado y no en verde | Parcial (ver [deuda técnica](#deuda-técnica-conocida)) |
| Tests unitarios | pytest | Configurado, sin `test_*.py` todavía |
| Evaluación RAG | Arnés propio (25 preguntas, informes HTML/CSV) | Hecho |
| Evaluación RAG | RAGAS | Planificado / opcional |
| CI/CD | GitHub Actions | Planificado |

## Estructura del proyecto

```text
Agent4U/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── lifespan.py        # carga los modelos y abre Qdrant una sola vez, al arrancar
│   │   │   ├── main.py            # la app FastAPI: CORS y montaje de los routers
│   │   │   ├── schemas.py         # modelos Pydantic de entrada y salida
│   │   │   └── routers/           # un fichero por área: health, query, indexation, documents, conversations
│   │   ├── core/
│   │   │   ├── config.py          # Settings vía pydantic-settings, leídas desde .env
│   │   │   └── exceptions.py      # excepciones de dominio, que los routers traducen a códigos HTTP
│   │   ├── db/
│   │   │   ├── models/            # tablas SQLAlchemy: documentos y conversaciones
│   │   │   ├── crud/              # acceso a datos, sin lógica de negocio
│   │   │   └── session.py         # motor y SessionLocal
│   │   ├── rag/
│   │   │   ├── grafo/             # el grafo de LangGraph: nodos y composición
│   │   │   ├── vectorization.py   # troceado con Docling y subida por lotes a Qdrant
│   │   │   ├── retrieval.py       # búsqueda híbrida (densa + dispersa) y reordenado
│   │   │   ├── generation.py      # construcción del contexto
│   │   │   ├── prompt.py          # las plantillas
│   │   │   └── streaming.py       # traducción a eventos SSE y persistencia de la respuesta
│   │   └── services/              # orquestación: indexación, consulta y documentos
│   ├── tests/
│   │   ├── unit/ integration/ api/  # la suite de pytest, espejo de los módulos que cubre
│   │   ├── evaluation/            # material manual de evaluación (no lo recolecta pytest)
│   │   └── README.md              # qué hay en cada nivel y cómo se lanza
│   ├── Dockerfile
│   ├── pyproject.toml
│   └── uv.lock
├── frontend/
│   ├── src/
│   │   ├── routes.ts              # el mapa de rutas: de aquí salen nav, pie, migas y las pruebas
│   │   ├── app/                   # la aplicación del agente (/app)
│   │   ├── sitio/                 # el sitio editorial (/), con sus páginas y datos
│   │   ├── features/              # chat, documentos, conversaciones, ajustes, comandos, salud
│   │   └── shared/                # api, hooks, lib, ui y los tokens de estilo
│   ├── pruebas-e2e/               # Playwright: Chromium y WebKit, con un backend falso
│   ├── herramientas/              # comprobaciones propias del bundle de producción
│   └── despliegue/nginx.conf      # SPA con fallback y proxy del SSE sin buffering
├── docker-compose.yml             # Qdrant y la API
└── README.md
```

## Puesta en marcha

**Requisitos**: Docker Desktop (o Docker Engine) y [uv](https://docs.astral.sh/uv/) instalados.

```bash
docker --version
uv --version
```

```bash
# 1. Clonar y entrar en el proyecto
git clone https://github.com/Pepe-alms/AGENT4U.git
cd AGENT4U

# 2. Levantar Qdrant
docker compose up -d qdrant
# Dashboard disponible en http://localhost:6333/dashboard

# 3. Instalar dependencias del backend (runtime + dev)
cd backend
uv sync

# 4. Configurar variables de entorno
#    cp backend/.env.example backend/.env   y rellena GEMINI_API_KEY
#    cp frontend/.env.example frontend/.env   (la URL del backend)

# 5. Levantar la API
uv run uvicorn app.main:app --reload
# http://127.0.0.1:8000/docs para la documentación interactiva (Swagger UI)
```

La primera ejecución descarga los modelos de ML de Docling y fastembed desde Hugging Face Hub (requiere red); a partir de ahí quedan cacheados en local (`~/.cache/huggingface/`) y el pipeline corre offline.

## Variables de entorno

| Variable | Prefijo | Obligatoria | Valor por defecto | Descripción |
|---|---|---|---|---|
| `GEMINI_API_KEY` | ninguno | Sí | — | API key de [Google AI Studio](https://aistudio.google.com/), usada por LiteLLM para llamar a Gemini |
| `APP_QDRANT_URL` | `APP_` | No | `http://localhost:6333` | URL del servidor Qdrant |
| `APP_LLM_MODEL` | `APP_` | No | `gemini/gemini-flash-lite-latest` | Identificador de modelo que recibe LiteLLM |

```bash
# backend/.env
GEMINI_API_KEY=tu-api-key-de-google-ai-studio
APP_QDRANT_URL=http://localhost:6333
APP_LLM_MODEL=gemini/gemini-flash-lite-latest
```

> `GEMINI_API_KEY` se lee sin prefijo (`os.getenv` directo en `app/core/config.py`), mientras que el resto de variables usan el prefijo `APP_` vía `pydantic-settings`. Es una inconsistencia menor, pendiente de unificar — ver [deuda técnica](#deuda-técnica-conocida).

## Uso de la API

Con el servidor arrancado, hay dos endpoints. FastAPI expone además documentación interactiva automática en `/docs` (Swagger UI) y `/redoc`.

### `POST /indexar`

Parsea un documento, lo trocea, genera embeddings y lo indexa en Qdrant. Espera una ruta de fichero **accesible por el proceso del servidor** — no es un endpoint de subida `multipart`, pensado para uso local por ahora.

```bash
curl -X POST http://localhost:8000/indexar \
  -H "Content-Type: application/json" \
  -d '{
        "ruta_archivo": "/ruta/absoluta/al/documento.pdf",
        "nombre": "manual-usuario-v2"
      }'
```

```json
{ "status": "indexado" }
```

> El nombre del documento no se manda: se deriva de la propia ruta (`os.path.basename`), así que no hay dos fuentes de verdad que puedan discrepar.

### `POST /preguntar`

Recupera los fragmentos más relevantes para la pregunta y genera una respuesta citando el documento de origen.

```bash
curl -X POST http://localhost:8000/preguntar \
  -H "Content-Type: application/json" \
  -d '{ "query": "¿Qué tres propiedades no pueden garantizarse a la vez según el teorema CAP?" }'
```

```json
{
  "respuesta": "Consistencia, disponibilidad y tolerancia a particiones de red [02-bases-datos-nosql.md]."
}
```

## Cómo funciona el pipeline

### Ingesta (`app/rag/vectorization.py`)

`normalize_text()` convierte el documento con Docling, lo trocea con `HybridChunker` y descarta ruido antes de embeber nada:

```python
RUIDO = {"page_header", "page_footer"}

for chunk in chunks:
    etiquetas = {item.label.value for item in chunk.meta.doc_items}
    if etiquetas and etiquetas <= RUIDO:
        continue  # chunk formado solo por cabecera/pie de pagina

    texto = chunker.contextualize(chunk)
    if len(texto) < 100:
        continue  # demasiado corto para aportar contexto util
```

`embed_texts()` genera los vectores y hace `upsert` en Qdrant con un ID determinista, calculado a partir del propio texto del chunk. Esto hace que reindexar el mismo documento sea idempotente en lugar de duplicar datos:

```python
def id_desde_texto(texto: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, texto))
```

### Recuperación (`app/rag/retrieval.py`)

`buscar_chunks()` embebe la pregunta con el prefijo `query:` (asimetría dense-retrieval estándar en modelos de la familia e5, que se entrenan distinguiendo `query:` de `passage:`) y llama a `qdrant.query_points()`, el método de búsqueda vigente en `qdrant-client` (sustituye al `search()` clásico, ya en desuso).

### Generación (`app/rag/generation.py`)

`build_context()` concatena los chunks recuperados etiquetados por documento; `generate_response()` los envía a LiteLLM junto con un system prompt que obliga a citar la fuente y a admitir cuando no hay respuesta en el contexto:

```python
system_prompt = """Eres un asistente que responde preguntas basándote ÚNICAMENTE en el contexto proporcionado.

Reglas estrictas:
- Responde solo con información presente en el contexto. No uses conocimiento previo.
- Si el contexto no contiene la respuesta, di exactamente: "No encuentro esa información en el documento." No inventes ni completes con lo que sepas.
- Cita el documento del que sacas la informacion con [nombre del documento], con el formato [documento1], [documento2], etc."""
```

### Decisiones de diseño

- **Docling frente a `pdfplumber`/`PyPDF2`**: estos últimos dan acceso a la geometría cruda del PDF (caracteres, coordenadas) pero no entienden qué es un título, una tabla o el orden de lectura — hay que reconstruir el significado a mano. Docling usa modelos ML pequeños y locales para reconstruir la estructura, y solo necesita red la primera vez que descarga esos modelos; a partir de ahí es 100% offline (compatible con entornos air-gapped).
- **`multilingual-e5-large` frente a alternativas más ligeras**: rinde mejor en recuperación multilingüe/español que la familia `paraphrase-multilingual` (entrenada para similitud de frases, no para búsqueda). Es más lento en CPU que un `MiniLM`, pero el proyecto prioriza calidad de recuperación sobre velocidad.
- **Distancia coseno frente a producto escalar (`DOT`) en Qdrant**: los vectores que produce fastembed no salen normalizados. Con `DOT` sin normalizar, los fragmentos con vector de mayor magnitud ganarían el ranking independientemente de su relevancia real. Qdrant normaliza internamente al insertar con `COSINE`, así que no hay coste de rendimiento por elegirla frente a `DOT`.

## Evaluación del sistema

En `backend/tests/evaluation/` viven el material de evaluación manual y los
sets de preguntas con los que se mide la calidad de las respuestas: 25 preguntas
sobre 11 documentos, repartidas en cinco tipos —exacta, semántica, tabla,
discriminación y **ausente**, esta última para comprobar que el sistema reconoce
cuándo *no* tiene la información en vez de inventarla—.

Pytest no recolecta esa carpeta (ver `python_files` en `pyproject.toml`); los
scripts se lanzan a mano y sí hablan con Qdrant y el LLM reales:

```bash
cd backend
uv run python tests/evaluation/index_hard_docs.py
```

**El arnés que puntuaba las respuestas de punta a punta no está hoy en el
repositorio**, solo sus sets de preguntas. El último resultado que quedó
registrado, con 25 preguntas × 5 rondas = 125 consultas, dio 100% de precisión
y 100% de retrieval con `gemini/gemini-flash-lite-latest` y un umbral de
similitud coseno de 0.85. Se cita como referencia histórica, no como una medida
reproducible ahora mismo: el dataset es pequeño y fijo, y servía de red de
seguridad de regresión, no de benchmark.

Reconstruirlo es trabajo pendiente.

## Calidad y desarrollo

```bash
# Backend
cd backend
uv run ruff check app      # lint
uv run pytest -q           # la suite automática

# Frontend
cd frontend
npm run verificar          # typecheck, lint, formato, unidad, e2e, build y bundle
npm run limpieza           # ficheros sin usar (knip)
```

**Estado actual**, medido:

| Comprobación | Resultado |
|---|---|
| `ruff check app` | en verde |
| `pytest` (backend) | 73 pasados |
| `vitest` (frontend) | 69 pasados |
| Playwright, Chromium + WebKit | 59 pasados, 5 saltados por capacidad del navegador |
| `knip` | sin hallazgos |
| `mypy app` | **no está en verde**: falla por configuración de paquetes, no por tipos |

## Flujo de trabajo con Git

Convención de ramas:

| Prefijo | Uso | Ejemplo |
|---|---|---|
| `feature/` | Nuevas funcionalidades | `feature/retrieval-hibrido` |
| `bugfix/` | Corrección de errores no críticos | `bugfix/payload-paginas` |
| `hotfix/` | Arreglos urgentes sobre `main` | `hotfix/error-conexion-qdrant` |
| `release/` | Preparación de una versión | `release/v0.2.0` |
| `docs/` | Cambios solo de documentación | `docs/readme-actualizado` |

Convención de commits observada en el historial (prefijo + descripción en presente): `ADD:` funcionalidad o fichero nuevo, `FIX:` corrección de un error, `FEAT:` hito o funcionalidad significativa.

```bash
git checkout -b feature/nombre-corto
git add <ficheros>
git commit -m "ADD: descripcion breve en presente"
git push -u origin feature/nombre-corto
```

## Roadmap y traza de mejoras

### Historial (hitos completados)

| Fecha | Hito |
|---|---|
| 2026-07-19 | Estructura inicial del monorepo, `uv init`, primer commit |
| 2026-08-07 | Primeros endpoints (salud, conexión a Qdrant) |
| 2026-08-08 | Ingesta con Docling + primer `upsert` de colecciones a Qdrant |
| 2026-08-09 | Retrieval: consulta de vectores desde Qdrant |
| 2026-08-14 | Indexación y retrieval conectados end-to-end vía API; payload con nombre de documento |
| 2026-08-15 | MVP funcional (Docling + fastembed + LiteLLM integrados); payload enriquecido con páginas y encabezados; arnés de evaluación con 25 preguntas |

### En curso / próximos pasos

| Fase | Alcance | Estado |
|---|---|---|
| Retrieval híbrido | Combinar dense + sparse (`BM25`) con RRF | Hecho — y con reordenado por cross-encoder encima |
| Generación con streaming | Respuesta por SSE en `/preguntar` | Planificado — hoy la respuesta es JSON bloqueante |
| Capa agéntica | Grafo con LangGraph: decidir si recuperar, reformular query, autocrítica | Planificado — sin iniciar |
| Frontend | Chat con streaming, subida de documentos, visor de fuentes citadas (React + Vite) | Planificado — carpeta reservada, sin scaffold |
| CI/CD | GitHub Actions: lint → tests → evaluación → build | Planificado — sin workflows todavía |
| Evaluación | Adoptar RAGAS o ampliar el arnés propio con más preguntas | Parcial — arnés propio ya operativo (ver [Evaluación del sistema](#evaluación-del-sistema)) |

### Ideas anotadas para la ingesta

- **Cachear el documento parseado con `save_as_json`**: parsear es la parte cara del pipeline (el modelo de layout, ~90s por documento); trocear es barato. Guardar el `DoclingDocument` ya parseado permitiría probar otro tamaño de chunk o reindexar tras cambiar de modelo de embeddings sin repetir el parseo — de minutos a segundos por iteración.
- **Ajustar la configuración de `DocumentConverter`**: hoy solo se desactiva el OCR; hay más superficie de configuración disponible, por ejemplo:

```python
from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode

opciones = PdfPipelineOptions(do_ocr=False, do_table_structure=True)
opciones.table_structure_options.mode = TableFormerMode.ACCURATE
opciones.accelerator_options = AcceleratorOptions(num_threads=4, device=AcceleratorDevice.AUTO)
```

### Deuda técnica conocida

- **Indexar un documento grande no cabe en una petición HTTP.** Medido: un PDF de
  176 páginas seguía vectorizando a los 90 minutos, y nginx corta a los 60
  segundos por defecto. Las protecciones actuales evitan que el proceso se caiga
  —el trabajo sale del event loop y hay techo de concurrencia con `429`— pero no
  arreglan la duración. La solución es una cola con el worker en un proceso
  aparte, respondiendo `202` y dando el progreso por SSE.
- `mypy app` no está en verde: falla por la configuración de paquetes, antes de
  llegar a comprobar tipos. No hay CI que haga cumplir lint ni tipado.
- Inconsistencia de prefijo entre `GEMINI_API_KEY` (sin prefijo) y el resto de
  variables (`APP_`) en `app/core/config.py`.
- Los orígenes de CORS están escritos a mano en `app/api/main.py` y solo
  contienen `localhost`. No molesta con el despliegue previsto, porque el
  frontend llama a `/api/` por nginx y es el mismo origen, pero cualquier otro
  despliegue queda bloqueado.
- No hay Dockerfile de frontend ni servicio de nginx en el compose: la
  configuración de `frontend/despliegue/nginx.conf` está escrita y todavía no la
  ejecuta nadie.
- `texto_crudo` se guarda en el payload de cada fragmento de Qdrant y ninguna
  consulta lo lee.

## Licencia

Sin licencia definida todavía. Hasta que se añada una, se asume todos los derechos reservados por el autor.
