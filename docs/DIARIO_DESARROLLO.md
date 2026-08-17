# Diario de desarrollo

Notas de aprendizaje, decisiones de diseño y experimentos tomados sobre la marcha mientras se construía el backend de Agent4U. Es un registro cronológico e informal — el punto de entrada oficial del proyecto es el [README](../README.md); esto es el detalle de "por qué" y "cómo se llegó" a cada decisión, incluyendo callejones sin salida y opciones descartadas.

No lo trates como documentación de referencia de la API: puede contener fragmentos de código exploratorios, rutas locales hardcodeadas y decisiones que luego se revirtieron.

---

**Stack tecnológico**

- **Lenguaje/backend:** Python 3.12 + FastAPI (async, streaming SSE, OpenAPI automático)
- **Gestión de dependencias:** uv (sustituye a pip/poetry; rapidísimo y es hacia donde va el ecosistema)
- **Orquestación agéntica:** LangGraph (grafo de estados: decidir si buscar, reformular query, iterar)
- **Ingesta/parsing:** Docling (PDF/DOCX con estructura, de IBM, muy superior a PyPDF2/python-docx crudos) + Trafilatura para limpiar HTML de URLs
- **Chunking:** por estructura del documento (títulos/secciones que Docling ya te da), con fallback a chunking recursivo por tokens
- **Base vectorial:** Qdrant (Docker en local, Qdrant Cloud free tier si quieres desplegarlo)
- **Embeddings:** BGE-M3 (dense + sparse en un solo modelo, ideal para tu búsqueda híbrida con RRF) vía fastembed
- **LLM:** capa abstraída con LiteLLM; empieza con Gemini Flash por coste y cambias de proveedor sin tocar código
- **Validación/config:** Pydantic v2 + pydantic-settings (variables de entorno tipadas)
- **Frontend:** React 19 + Vite + TypeScript + TanStack Query; streaming por SSE
- **Contenedores:** Docker Compose (api + qdrant + front)
- **Calidad:** ruff (lint+format), pytest, mypy
- **Evaluación RAG:** RAGAS con un dataset fijo de preguntas/respuestas
- **CI/CD:** GitHub Actions (fase posterior: lint → tests → eval → build → deploy)


Otra opcion de alimentacion es:

**LlamaIndex Core (ingesta)**
llama-index-core
llama-index-vector-stores-qdrant
llama-index-embeddings-huggingface

**LangSmith** (para monitoreo)
**LangGraph** (para flujos cíclicos y agentes)

LangChain para los componentes ya que es muy lineal
LangGraph para el cerebro porque encaja en la toma de decisiones


**Fase 0 — Esqueleto (1 tarde).** Repo en GitHub, uv init, estructura de monorepo (backend/ y frontend/), docker-compose.yml con Qdrant, ruff y pytest configurados desde el commit 1. Que el CI de lint+tests exista desde el principio aunque solo tenga un test dummy: añadirlo luego siempre duele más.

  

**1. Prepara las herramientas.** Necesitas Docker Desktop (o Docker Engine) y uv instalado en tu máquina. Instala uv con el script oficial de Astral (está en docs.astral.sh/uv). Verifica ambos con docker --version y uv --version antes de seguir; media hora perdida aquí te ahorra dos después.

Para hacer la instalacion optamos por hacer uso de "brew", que es el gestor de paquetes de macOS

```
pepealms@MacBook-Air-de-Jose ~ % brew install uv
pepealms@MacBook-Air-de-Jose ~ % uv --version   
uv 0.11.29 (Homebrew 2026-07-15 aarch64-apple-darwin)
```
 
 uv es un gesto de proyectos desarrollado por Astral y esta escrito en Rust. Permite la creación de entornos virtuales aislados, resuelve e instala librerías mucho mas rápido y gestiona la versión de librerias para otros desarrolladores. `uv.lock` permite que la version excata de los paquetes que estamos utilizando se quede estatica, lo que permite que la version encaje con el CI.
Al usarlo junto con docker reduces el tiempo de las construcciones.

Para subidas a GitHub:

- **`feature/`**: Para nuevas funcionalidades o características. _Ejemplo:_ `feature/nuevo-login`.
- **`bugfix/`**: Para corrección de errores que no son críticos en producción. _Ejemplo:_ `bugfix/boton-envio`.
- **`hotfix/`**: Para arreglos urgentes y directos en la rama de producción (`main`). _Ejemplo:_ `hotfix/error-pasarela-pago`.
- **`release/`**: Para preparar una nueva versión lista para producción. _Ejemplo:_ `release/v1.2.0`
- **`docs/`**: Para cambios exclusivos en la documentación del proyecto. _Ejemplo:_ `docs/readme-actualizado`

```
git remote add origin 
git add .
git commit -m ""
git push -u origin 
```

Dentro del backend: `uv init --name agent4u-backend`, esto equivale a un pyproyect.toml que es equivalente a un requeriments.txt + git setup.py. `uv python pin 3.12` adicionalmente establecemos fija la versión. 
Las de _runtime_ (lo que la app necesita para funcionar en producción): `uv add fastapi "uvicorn[standard]" pydantic-settings qdrant-client`. Las de _desarrollo_ (herramientas que solo usas tú y el CI, nunca se despliegan): `uv add --dev pytest pytest-asyncio httpx ruff mypy`.
Con `uvicorn` lo que generamos es un servidor asíncrono, se encarga de conectarse a la red y recibe las peticiones HTTP que llegan desde el navegador.

pyproject.toml:  se ha generado al hacer `uv init`, en su contraparte es como el uso de package.json en Node y tiene 3 partes bien diferenciadas:

- **Identidad y metadatos**: viene dado por el bloque [proyect], declara el nombre, la versión y la descripcción. Esto es lo que va a leer docker cuando vaya a construir la imagen.
- **Dependencias**: se establece en la sección de [dependencies], y establece las versiones y paquetes que necesita el código, viene a sustituir a los `requeriments.txt`
- **Configuración**: Los bloques [tool.]configura el comportamiento de las herramientas ezternas que analizan el código

```
pepealms@MacBook-Air-de-Jose backend % uv run ruff check .
All checks passed!
pepealms@MacBook-Air-de-Jose backend % uv run mypy app
Success: no issues found in 5 source files
pepealms@MacBook-Air-de-Jose backend % 
```

### Generamos el `config.py`

En base al stack tecnológico que tenemos, tenemos: 

- **Orquestación agéntica:** LangGraph (grafo de estados: decidir si buscar, reformular query, iterar)
- **Ingesta/parsing:** Docling (PDF/DOCX con estructura, de IBM, muy superior a PyPDF2/python-docx crudos) + Trafilatura para limpiar HTML de URLs
- **Chunking:** por estructura del documento (títulos/secciones que Docling ya te da), con fallback a chunking recursivo por tokens
- **Base vectorial:** Qdrant (Docker en local, Qdrant Cloud free tier si quieres desplegarlo)
- **Embeddings:** BGE-M3 (dense + sparse en un solo modelo, ideal para tu búsqueda híbrida con RRF) vía fastembed
- **LLM:** capa abstraída con LiteLLM; empieza con Gemini Flash por coste y cambias de proveedor sin tocar código
- **Validación/config:** Pydantic v2 + pydantic-settings (variables de entorno tipadas)
- **Frontend:** React 19 + Vite + TypeScript + TanStack Query; streaming por SSE


Vamos a hacer un walking skeleton:

python3 -m venv .venv      
source .venv/bin/activate   
pip3 install fastapi uvicorn
deactivate

FastAPI nos va a permitir hacer llamadas asincronas

**Métodos de Enrutamiento (Operaciones HTTP)

Estos son los métodos que más usarás. Se utilizan como **decoradores** (con el símbolo `@`) para conectar una URL específica con una función de Python.

- **`@app.get(path)`**: Para leer o solicitar datos (ej. obtener la lista de usuarios).
- **`@app.post(path)`**: Para enviar datos y crear algo nuevo (ej. registrar un usuario).
- **`@app.put(path)`**: Para actualizar un dato existente reemplazándolo por completo.
- **`@app.patch(path)`**: Para actualizar solo una parte de un dato existente.
- **`@app.delete(path)`**: Para eliminar un dato.
- **`@app.options(path)`**, **`@app.head(path)`**, **`@app.trace(path)`**: Para peticiones HTTP más avanzadas.
- 
**Modularización e Integración

Cuando tu aplicación crece, no puedes tener todas las rutas en `main.py`. Estos métodos te ayudan a organizar el código.

- **`app.include_router(router)`**: Te permite conectar grupos de rutas (creadas con la clase `APIRouter`) a tu aplicación principal. Es la clave para estructurar proyectos grandes.
    
- **`app.mount(path, app)`**: Permite "montar" otra aplicación independiente (como una app de WSGI pura o archivos estáticos) en una ruta específica. Se usa muchísimo para servir imágenes, CSS o JavaScript con `StaticFiles`.

**Manejo de Peticiones en Tiempo Real

- **`@app.websocket(path)`**: Abre un canal de comunicación bidireccional permanente entre el servidor y el cliente (ideal para chats, notificaciones en vivo, o streaming de datos).

**Interceptores (Middlewares y Excepciones)

Estos métodos te permiten ejecutar código "en medio" de una petición, antes de que llegue a tu ruta o antes de que la respuesta vuelva al usuario.

- **`@app.middleware("http")`** o **`app.add_middleware()`**: Permite añadir funciones que se ejecutan en _todas_ las peticiones. Es útil para verificar tokens de seguridad, medir el tiempo que tarda una petición, o añadir cabeceras CORS (para permitir que otras webs consulten tu API).
    
- **`@app.exception_handler(Exception)`** o **`app.add_exception_handler()`**: Te permite capturar errores específicos (como cuando un usuario no existe) y devolver una respuesta JSON personalizada en lugar del típico mensaje de error de servidor.

**ASGI** es la especificación que define cómo hablan un servidor web y una aplicación Python asíncrona. Uvicorn es un servidor ASGI y FastAPI es una aplicación ASGI. Lo que hace `ASGITransport` es sustituir al servidor y hablar el protocolo directamente contra tu app. uvicorn es un servidor web ASGI, sirve parea ejecutar aplicaciones web asyncornas en Python

uv run pytest -v


**Qué es Docker Compose.** Es una forma de describir en un fichero de texto los servicios que componen tu sistema, para levantarlos todos con un comando en lugar de lanzar contenedores a mano con parámetros largos. El fichero es YAML, y su unidad básica es el _servicio_: un contenedor con su imagen y su configuración. El contenido de nuestro .yaml debe contener:
- "image": la imagen de Qdrant con la version explicita
- "ports": mapea los puetos
- "volumenes": para que los datos persistan
- "healthchech": comando que ejecuta docker de forma periodica para validar que el servicio es funcional

pepealms@MacBook-Air-de-Jose Agent4U % docker compose up -d qdrant




**Fase 1 — Pipeline de ingesta (el 40% del valor).** Un script/endpoint que recibe un PDF, DOCX o URL y lo deja indexado en Qdrant: parseo con Docling/Trafilatura → chunking → embeddings BGE-M3 → upsert con payload (fuente, título, sección, hash para deduplicar). Pruébalo con 4-5 documentos reales tuyos y verifica los chunks a mano en el dashboard de Qdrant (localhost:6333/dashboard). Si los chunks son malos, todo lo demás será malo.

INGESTA:

ANTES USABA pdfplumber, Trabaja sobre la geometría del PDF: te da acceso a los caracteres, palabras, líneas y rectángulos con sus coordenadas exactas (x, y) en la página. No "entiende" nada del documento — no sabe qué es un título, ni cuál es el orden de lectura, ni qué bloque es una tabla. Te entrega las piezas geométricas en crudo y _tú_ reconstruyes el significado escribiendo tu propia lógica. Solo maneja PDFs.

**Docling** brilla cuando los documentos son variados, desordenados o desconocidos, y no quieres escribir lógica de extracción a medida para cada uno. Es justo el caso de un RAG que ingiere documentación heterogénea. A cambio, es más pesado (modelos de ML, la GPU ayuda) y menos determinista,
Reconstruye la _estructura_ de un documento usando modelos de ML pequeños y locales, y opcionalmente usa OCR para escaneos.

uv add docling

Instalamos la libreria docling, que permite convertir documentos como pdf o words en textos estructurados que se pueden introducir en un sistema de IA. 

La clase central es `DocumentConverter`. Instancias una y llamas a su método `.convert()` pasándole la fuente — que puede ser una ruta local o una URL directamente. Eso te devuelve un objeto resultado del que sacas `.document`: ahí vive el `DoclingDocument`, la representación unificada de la que hablábamos.

Sobre ese `.document` tienes los métodos de exportación, que son los que de verdad usas según lo que necesites aguas abajo: `.export_to_markdown()` cuando quieres el texto cómodo para el LLM, `.export_to_dict()` o el JSON cuando quieres la estructura completa sin pérdida. Con eso ya tienes el documento parseado.

La segunda pieza, opcional pero relevante para ti, es el chunking. En lugar de exportar a Markdown y trocear tú a ciegas, importas `HybridChunker`, lo instancias, y le pasas el `DoclingDocument` a su método `.chunk()`. Te devuelve un iterable de chunks que ya respetan la estructura del documento. Esa es la ventaja: el chunker "entiende" dónde están las secciones y tablas, no corta a mitad.

O sea, la secuencia conceptual es: `DocumentConverter` → `.convert(fuente)` → `.document` → (opcional) `HybridChunker.chunk(document)`. Tres o cuatro llamadas y tienes los chunks listos. Te dejo que montes tú el código con esas piezas — dime si te atascas en alguna.


DocumentConverter

https://docling-project.github.io/docling/reference/document_converter/

```
from docling.document_converter import DocumentConverter
  
converter = DocumentConverter()

resultado = converter.convert("/Users/pepealms/Documents/Agent4U/backend/data/Big Data ESP 7.pdf")

resultado.document.save_as_markdown("/Users/pepealms/Documents/Agent4U/backend/data/Big Data ESP 7.md")

```


**La primera vez** que ejecutas Docling con una configuración dada, baja sus modelos de ML desde Hugging Face Hub y los guarda en una caché local en tu disco (normalmente bajo `~/.cache/huggingface/` y, como viste en tu log, algún modelo como RapidOCR en su propia ruta dentro del `.venv`). Ese paso _sí_ requiere salida a internet. Sin red en ese momento, la descarga es imposible y Docling no arrancaría porque le faltan los pesos.

**A partir de ahí**, los modelos ya están en tu máquina. Docling los lee de la caché local y no vuelve a tocar la red. Ejecución totalmente offline. De hecho esto es precisamente uno de los puntos de diseño de Docling que te mencioné al principio: soporta ejecución en local y en **entornos air-gapped** (máquinas sin salida a internet). No sería air-gapped-friendly si necesitara internet cada vez.

Para pasar a la parte de troceado, Docling tiene chunkers que hacen este proceso automatico, lo que nos va a permitir mantener la estructura y el sentido semantico.
El `HybridChunker` de Docling hace justo eso: parte de un troceado jerárquico basado en la estructura del documento y luego aplica refinamientos según el tokenizador que le indiques.


[The `LineBasedTokenChunker` is a tokenization-aware chunker that preserves line boundaries, particularly useful for structured content like tables, code, logs, and lists. It attempts to keep lines intact within chunks, only splitting a line if it exceeds the maximum token limit on its own.]

Key capabilities:

- Prioritizes keeping entire lines within a single chunk
- Supports adding a repeated prefix to each chunk (e.g., table headers for context)
- Offers overflow handling via `omit_prefix_on_overflow` parameter: when `True`, omits the prefix for lines that would overflow with it but fit without it

chunk(dl_doc=...) <- Lo que ponemos es el DoclinDocument que es el documento listo para trocear



Vamos a usar `fastembed`, de la propia gente de Qdrant: es ligera, no arrastra PyTorch entero y encaja de forma natural con la base de datos.

```
uv add fastembed
```


https://qdrant.github.io/fastembed/


uv run python -c "from fastembed import TextEmbedding; [print(m['model'], m['dim']) for m in TextEmbedding.list_supported_models()]"

Mi recomendación: **`intfloat/multilingual-e5-large`** (1024 dimensiones).

El porqué: es el que mejor rinde en recuperación multilingüe de la lista, y tus documentos están en español. Los de la familia `paraphrase-multilingual` son más ligeros pero fueron entrenados para similitud de frases, no para búsqueda, y se nota. `jina-embeddings-v3` sería la otra opción seria; `jina-embeddings-v2-base-es` es bilingüe español-inglés y también válido, pero e5 tiene más recorrido probado en RAG.

**El coste:** e5-large son 1024 dimensiones y un modelo grande. En tu MacBook Air, sobre CPU, generar 66 vectores irá bien; cuando ingestes cincuenta documentos notarás la espera. Si prefieres velocidad sobre calidad, `paraphrase-multilingual-MiniLM-L12-v2` (384 dim) es unas cinco veces más rápido a cambio de peor recuperación. Mi consejo: empieza por calidad, que es lo que define si el RAG sirve o no.


Parámetros de Inicialización (`TextEmbedding.__init__`)

- `model_name` o `id` (_str_): Nombre o identificador del modelo en Hugging Face (por defecto es `"BAAI/bge-small-en-v1.5"`).

- `cache_dir` (_str_ o _Path_, opcional): Ruta para guardar o cargar los archivos del modelo en caché.

- `threads` (_int_, opcional): Número de hilos que usará ONNX Runtime.

- `cuda` (_bool_): Si se debe usar la GPU con CUDA (por defecto `False`).

- `providers` (_list_, opcional): Proveedores de ejecución de ONNX Runtime (`CUDAExecutionProvider`, `CPUExecutionProvider`, etc.). [[1](https://docs.agno.com/reference/knowledge/embedder/fastembed), [2](https://dev.to/qdrant/fastembed-fast-and-lightweight-embedding-generation-for-text-4i6c), [3](https://github.com/qdrant/fastembed)]

Parámetros del Método de Generación (`TextEmbedding.embed`)

- `documents` (_str_ o _Iterable[str]_): El texto individual o la lista de textos (documentos o consultas) que se van a vectorizar.

- `batch_size` (_int_): Tamaño del lote para procesar los textos de forma eficiente (por defecto suele ser `256`).

- `parallel` (_int_, opcional): Grado de paralelismo para la codificación.

- `cache_dir` / otros argumentos específicos del modelo según la versión.


similitud coseno entre vectores
La idea que resume todo: **la similitud coseno mide el ángulo entre las flechas**, no lo que valen los números uno a uno. Flechas que apuntan casi igual = frases parecidas. Los 1024 números solo sirven para colocar la punta de cada flecha en el espacio; el significado está en _hacia dónde apunta_, no en cada coordenada suelta.

- un **id** (un identificador único, para saber qué es),
- el **vector** (tus 1024 números, el embedding completo),
- y el **payload** (metadatos: el texto original del chunk, de qué documento viene, la página, etc.).

**TensorFlow Embedding Projector**

Ahora procedemos a crear colecciones en Qdrant

https://qdrant.tech/documentation/ops-configuration/configuration/
https://qdrant.tech/documentation/quickstart/

```
settings = get_settings()
qdrant_client = QdrantClient(url=settings.qdrant_url)  

qdrant_client.create_collection(
	collection_name="Test_1",
	vectors_config=VectorParams(size= 4, distance=Distance.DOT)
	)
```

El tamaño es **1024** — el número que acabas de confirmar imprimiendo `len(vectores[1])`. Tiene que coincidir exactamente con la dimensión de tu modelo, o Qdrant rechazará los vectores al insertarlos.

La distancia es **coseno** (`Distance.COSINE`). Es la métrica que has calculado a mano hace un momento con `np.dot` dividido por las normas: mide el ángulo entre vectores, ignorando su longitud. Es la adecuada para embeddings de texto porque lo que importa es la _dirección_ del vector (el significado), no su magnitud.

Las otras opciones que verás en `Distance` son `EUCLID` (distancia en línea recta, sensible a la magnitud) y `DOT` (producto escalar sin normalizar, útil solo si tus vectores ya vienen normalizados). Para tu caso, coseno.

RAZONAMIENTO:

**El razonamiento general.** Coseno mide el ángulo entre dos vectores e ignora su longitud. En texto eso es justo lo que quieres: un párrafo largo y un párrafo corto sobre el mismo tema apuntan en la misma dirección, pero el largo suele tener un vector de mayor magnitud. Con una métrica sensible a la longitud, esa diferencia de tamaño contaminaría la comparación de significado.

**El dato concreto.** Cuando imprimiste un vector, salían valores como `1.73` y `-0.83`. Eso significa que **tus vectores no están normalizados** (si lo estuvieran, su norma sería 1 y los componentes serían mucho más pequeños). Y ahí está la clave: con vectores normalizados, coseno y producto escalar dan exactamente el mismo orden de resultados, y daría igual cuál elegir. Como los tuyos **no** lo están, elegir `DOT` te daría rankings distintos y peores — favorecería sistemáticamente a los fragmentos con vector más largo, independientemente de su relevancia.

O sea: en tu caso concreto, coseno no es solo una convención, es necesario.

**Sobre `EUCLID`:** con vectores normalizados es equivalente a coseno en cuanto a orden; sin normalizar, sufre el mismo problema que el producto escalar. No aporta nada aquí.

Un matiz de rendimiento por si lo lees en algún sitio: internamente Qdrant normaliza los vectores al insertarlos cuando la métrica es coseno, así que en tiempo de búsqueda calcula un producto escalar sin coste adicional. No pierdes velocidad por elegir coseno.


**¿Por dónde seguimos?** Tienes dos caminos:

**A) Generar respuestas** — conectar un LLM que reciba estos fragmentos y responda a la pregunta en lenguaje natural. Es lo que convierte esto en un RAG de verdad y lo que te dará la primera demo enseñable.

Instalamos LiteLLM, que hace que podamos interactuar via API con varias de los modelos mas comunes de las APIs. Generamos en el .env la variable global 

GEMINI_API_KEY=<REDACTADA — el valor original era una key real de Google AI Studio pegada en texto plano; rótala y no la reutilices>

Y la rescatamos haciendo, api key = os.getenv("gemini_api_key"). y haciendo load_dotenv() ya tenemos la key en cache.

```
import litellm

import os
import sys
from dotenv import load_dotenv

load_dotenv()

gemini_api_key = os.getenv("GEMINI_API_KEY")

# for nombre, datos in litellm.model_cost.items():
# if datos.get("litellm_provider") == "gemini":
# print(nombre, datos.get("input_cost_per_token"),

datos.get("output_cost_per_token"))

respuesta = litellm.completion(
	model = "gemini/gemini-flash-lite-latest",
	messages = [{"role": "user", "content": "¿Qué es el big data?"}])
print(respuesta.choices[0].message.content)
```

```
vectores_optimos = []

for i, result in enumerate(search_result):

texto = result.payload['chunk']

vectores_optimos.append(f"[{i+1}]: {texto}")

  

contexto = "\n\n".join(vectores_optimos)

  

consulta = f"Contexto:{contexto} Consulta:{query_string}"

  
  

respuesta = litellm.completion(

model = "gemini/gemini-flash-lite-latest",

messages = [{"role": "user", "content": consulta},

{"role": "system", "content": system_prompt}])

  

print(respuesta.choices[0].message.content)
```


Aplicamos pydantic como paquete de consultas: https://www.datacamp.com/es/tutorial/litellm?dc_referrer=https%3A%2F%2Fwww.google.com%2F

```
from pydantic import BaseModel

## validamos que el contenido de la consolta como minimo tenga un campo query de tipo string

class Consulta(BaseModel):
	query: str
```


Uvicorn es un servidor web ASGI (Asynchronous Server Gateway Interface) para Python. Su función principal es ==recibir peticiones HTTP de internet y pasarlas a un framework asíncrono como FastAPI==


```
from fastapi import FastAPI, Request

from app.api.schemas import Consulta

from app.api.app_state import lifespan

from app.core.config import get_settings

from app.retrieval.retrieval import buscar_chunks

from app.rag.generation import generate_response, build_context

  

app = FastAPI(lifespan=lifespan)

  

@app.post("/preguntar")

def preguntar(body: Consulta, request: Request):

  

embedder = request.app.state.embedder

qdrant = request.app.state.qdrant

  
  

chunks = buscar_chunks(query=body.query, embedder=embedder, qdrant= qdrant)

response = generate_response(query=body.query, chunks=chunks, model=get_settings().llm_model)

return {"respuesta": response}
```

Dentro de la normalización de texto, se puede obtener el page number dentro de los doc_items. lo que hacemos es examinar el contenido dentro del chunk:

```
paginas = sorted(set(
	prov.page_no
	for item in chunk.meta.doc_items
	for prov in item.prov
))
```

Un contenido adicional dentro del **`prov`** seria:

- **`bbox`**: Las coordenadas exactas (caja de delimitación) del texto en la página.
- **`char_start` y `char_end`**: Los índices de caracteres exactos dentro del documento original.

##### #15/06/2026

Se ha añadido algo y es que en la parte del chunking, se ha establecido el mismo modelo y se han usado reglas dentro de la preparacion de los chunks para vectorizacion, ademas de la mejora del payload, enriqueciendo cada uno de los nodos 

##### #16/06/2026

Inicio del bloque dos, busqueda hibrida y rerankear.BM25 lo que hace es otorgar mayor peso a palabras menos comunes, de forma que siglas especificas o puntualizaciones es mas facil de obtener que palabras comunes. Juntando el metodo calsico con una vectorizacion dispersa, esta vectorizacion en lugar de dar 1024 valores, lo que hace es  que tiene una entrada por cada termino presente en el texto. 

(JUTAMOS: VECTORIZACION DESNSA + VECTORIZACION DISPERSA)

**Vectorización dispersa cómo funciona:** Si tu sistema conoce 100,000 palabras, cada texto se convierte en un vector de 100,000 posiciones. Si una frase solo tiene 10 palabras, el vector tendrá 10 valores distintos de cero y 99,990 ceros. Lo que proporciona una búsqueda de palabras extactas perfecta, como desventaja es que no interpreta sinónimos ni paralelismos.

(usaremos el modelo Qdrant/bm25. Al no ser una red neuronal y basar su estadistica en el contenido lexico de las palabras, ignora completamente el idioma)

**Vectorización densa cómo funciona:** Se utilizan redes neuronales para "leer" el texto y comprimir su significado semántico en un vector compacto (conocido como _embedding_). Textos con significados similares terminan teniendo vectores muy parecidos, independientemente de las palabras exactas que usen. La ventaja es que puede encontrar mucho mejor las similitudes semanticas, como contrapunto es que requiere una potencia de computo mayor.






**B) Mejorar la recuperación** — búsqueda híbrida (dense + BM25) y reranker, que es donde están las dos centésimas de margen.




**Fase 2 — Retrieval híbrido.** Endpoint /search que hace dense + sparse + RRF y devuelve los pasajes con scores. Sin LLM todavía. Esto te permite evaluar la calidad de recuperación de forma aislada, que es donde se ganan o pierden los RAG.

**Fase 3 — Generación con streaming.** Endpoint /chat que recupera, construye el prompt con citas a las fuentes y streamea la respuesta por SSE. Aquí ya tienes un RAG completo usable por curl.

**Fase 4 — Capa agéntica con LangGraph.** Conviertes el flujo lineal en grafo: nodo que decide si la query necesita recuperación o no, nodo de reescritura de query, nodo de autocrítica que relanza la búsqueda si el contexto es pobre. Es un refactor pequeño si las fases 1-3 están limpias.

**Fase 5 — Front React.** Chat con streaming, panel de subida de documentos, y visor de fuentes citadas. Con el OpenAPI de FastAPI puedes generar el cliente TypeScript automáticamente.

**Fase 6 — RAGAS + CI/CD completo.** Dataset de ~20 preguntas con respuesta esperada sobre tus documentos de prueba, y el pipeline que falla si faithfulness o context precision caen por debajo de un umbral.






Lo que me apunto para póximas incorporaciones son:

##### El save_as_json de los documentos docling: 

Lo que ofrece es una mejora en el tema del parseado, al ya tener el parsing, es mas agil una nueva configuracion sin tener que pasar todos los documentos otra vez por la "espada", los puedes reindexar mejor. 

[Respuesta del Claude:] El beneficio es de tiempo. En tu pipeline, parsear es lo caro (el modelo de análisis de disposición, esos 90 segundos iniciales) y trocear es barato. Si guardas el documento parseado, cada vez que quieras probar otro tamaño de chunk, otro filtro o reindexar tras cambiar de modelo de embeddings, te saltas el parseo entero. Pasas de minutos a segundos por iteración. En la documentación lo verás como `export_to_dict()` y su equivalente de carga.

##### Ajustar la configuracion del DocumentConverter: 

Ahora miso solo tiene puesta la configuracion del ocr para documentos pdf, pero es muuuuucho mas configurable

```
from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode

opciones = PdfPipelineOptions(do_ocr=False, do_table_structure=True)
opciones.table_structure_options.mode = TableFormerMode.ACCURATE
opciones.accelerator_options = AcceleratorOptions(num_threads=4, device=AcceleratorDevice.AUTO)
```





from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance


settings = get_settings()

qdrant_client = QdrantClient(url=settings.qdrant_url)

  

qdrant_client.recreate_collection(

collection_name="Test_1",

vectors_config=VectorParams(size= 1024, distance=Distance.COSINE)

)


**Gestión de la colección** (la preparación, se hace una vez):

`create_collection(...)` — crea la colección. Aquí es donde fijas la dimensión y la métrica: le pasas un `vectors_config` con `VectorParams(size=1024, distance=Distance.COSINE)`. Ese `size=1024` es el número que venimos arrastrando, y `Distance.COSINE` es la misma similitud que calculaste a mano.

`collection_exists(nombre)` — devuelve `True`/`False`. Útil para no intentar crear una colección que ya existe (si la creas dos veces, error). El patrón habitual es "si no existe, créala".

`delete_collection(nombre)` — la borra entera. La usarás en desarrollo, cuando quieras empezar de cero (por ejemplo si cambiaste de modelo de embeddings y necesitas re-embeber todo).

`get_collection(nombre)` — te da información de la colección: cuántos puntos tiene, su configuración. Para inspeccionar y depurar.

**Escritura de datos** (meter tus chunks):

`upsert(...)` — **el método central de inserción.** Le pasas el nombre de la colección y una lista de `PointStruct`, donde cada punto lleva `id`, `vector` (tus 1024 números) y `payload` (el texto del chunk y sus metadatos). "Upsert" = insertar o actualizar: si el id ya existe, lo sobrescribe; si no, lo crea. Por eso es idempotente y cómodo — puedes relanzar la ingesta sin duplicar.

Existe también `upload_points(...)` / `upload_collection(...)`, pensados para cargas masivas: trocean los datos en lotes automáticamente para no reventar el límite de tamaño de petición. Cuando ingieras muchos chunks de golpe, estos son mejores que un `upsert` gigante.

**Búsqueda** (recuperar, el corazón del RAG):

`query_points(...)` — **el método de búsqueda actual.** Le pasas el vector de tu pregunta (`query=...`), un `limit` (cuántos resultados quieres) y normalmente `with_payload=True` para que te devuelva también el texto, no solo los ids. Te devuelve los puntos más parecidos ordenados por similitud. Fíjate: el resultado viene en `.points`, y cada hit tiene `.id`, `.score` (la similitud) y `.payload` (tu texto).

Un aviso importante de versión, porque en internet verás las dos formas y te confundirá: el método antiguo se llamaba `search(...)` (con `query_vector=...`). Sigue funcionando pero está **en desuso**; Qdrant lo reemplazó por `query_points`. Si arrancas ahora, usa `query_points` desde el principio — es el que tiene futuro y más capacidades. Cuando veas tutoriales con `client.search(...)`, sabe que es la forma vieja.

**Utilidades que usarás pronto:**

`scroll(...)` — pagina por los puntos **sin** vector de consulta, filtrando por payload. Sirve para "dame todos los chunks del documento X" o recorrer la colección. No es búsqueda por similitud, es recorrido.

`retrieve(...)` — recupera puntos por su `id` directamente, si ya sabes cuáles quieres.

`count(...)` — cuenta puntos, opcionalmente con filtro. Bueno para verificar que tu ingesta metió lo que esperabas.

`delete(...)` — borra puntos concretos (por id o por filtro).

El flujo mínimo de tu proyecto usa solo cuatro: `create_collection` una vez, `upsert` para meter chunks, `query_points` para buscar, y `get_collection`/`count` para comprobar que fue bien. El resto los irás necesitando conforme crezca.

Un detalle que te ahorrará un error: casi todos estos métodos reciben clases del módulo `models` (o `qdrant_client.models`) — `VectorParams`, `Distance`, `PointStruct`, `Filter`. Tendrás que importarlas de ahí; no son strings sueltos.


**Nomenclaturas de commits**

Para poder hacer un seguimiento de los cambios que se aplican en el poryecto, se establecen las siguientes nomencalturas como las adecuadas

- ADD: Añade una nueva característica al sistema.
- FIX: Corrige un error o fallo (bug).
- DOCS: Cambios exclusivos en la documentación.
- STYLE: Cambios de estilo que no afectan el significado del código (espacios, comas, etc.).
- REFACTOR: Refactorización del código sin agregar funciones ni corregir errores.
- TEST: Adición o corrección de pruebas.
- CHORE: Tareas de mantenimiento, actualización de dependencias
