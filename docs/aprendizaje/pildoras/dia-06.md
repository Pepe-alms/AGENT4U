# Píldora 06 — Ingesta en detalle: Docling → chunking → embeddings → Qdrant

**Viernes 30-oct-2026 · 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 05

No hay entrega del día 05: en `origin/aprendizaje` no existe `entregas/dia-05.md` y en el remoto no hay rama `ejercicio/dia-05`. Tampoco han llegado tarde la 02, la 03 ni la 04. Sin nota.

Una sola cosa práctica: el ejercicio de hoy reutiliza el montaje del día 05 (API y worker en local con una base y una colección aparte), así que si lo haces hoy, ya tienes medio día 05 hecho. Y si haces el 05 más adelante, fíjate en una cosa que hoy entenderás: los siete documentos de prueba de aquel ejercicio habrían acabado en `indexado` con **0 fragmentos** (sección 3).

`main` sigue en `fb93eea` (21-oct). Todo lo que sigue está comprobado contra ese código.

---

## 1. Concepto clave: de un fichero a puntos en Qdrant

El día 05 viste el *sobre* de la ingesta: cola, estados, worker. Hoy abrimos la caja negra de `_trabajo` (`worker/jobs.py:45-55`), que son cuatro transformaciones encadenadas:

```text
fichero/URL ──Docling──▶ DoclingDocument ──HybridChunker──▶ fragmentos
   ──filtro de ruido──▶ textos + payloads ──fastembed──▶ vector denso + vector BM25
   ──upsert por lotes──▶ puntos en Qdrant
```

### 1.1 Docling: convertir con estructura

Un PDF no es texto: es una lista de glifos con coordenadas. Librerías como `pypdf` te devuelven los caracteres en el orden en que están en el fichero, que no tiene por qué ser el orden de lectura, y no saben qué es un título, una tabla o un pie de página.

Docling convierte el documento a un **`DoclingDocument`**: un árbol de elementos tipados (`title`, `section_header`, `text`, `table`, `list_item`, `page_header`, `page_footer`...) con su procedencia (`prov`: página y caja). Para PDF usa modelos de ML locales: uno de *layout* (qué es cada región) y TableFormer (estructura de tablas). Para Markdown, DOCX o HTML no hace falta ningún modelo: los parsea directamente.

### 1.2 Chunking: por qué trocear y cómo lo hace `HybridChunker`

Un modelo de embeddings convierte un texto en **un único vector**. Si le das un capítulo entero, el vector es un promedio borroso de todo lo que dice; si le das una frase suelta, pierde el contexto. Trocear (*chunking*) es elegir la unidad de recuperación.

Además, el modelo tiene un **límite de entrada**: `multilingual-e5-large` trunca a 512 tokens. Lo que pase de ahí no se vectoriza, en silencio.

`HybridChunker` de Docling hace tres pasadas:

1. **Jerárquica:** un fragmento por elemento del documento, agrupado bajo los encabezados de su sección (`chunk.meta.headings`).
2. **División:** si un fragmento supera `max_tokens` (contados con **el tokenizador del modelo de embeddings**), lo parte.
3. **Fusión** (`merge_peers=True` por defecto): junta fragmentos consecutivos demasiado pequeños **si comparten los mismos encabezados**.

Y `chunker.contextualize(chunk)` devuelve el texto que se va a vectorizar: los encabezados de la sección, uno por línea, y después el texto. Es decir, cada fragmento "sabe" en qué sección estaba. Lo he comprobado con un Markdown de prueba:

```text
'Manual de AGENT4U\nInstalación\nPara instalar el sistema necesitas Docker...'
```

### 1.3 Dos vectores por fragmento

- **Denso** (`intfloat/multilingual-e5-large`, 1024 dimensiones): captura el significado. Dos frases con palabras distintas y el mismo sentido quedan cerca. La familia e5 está entrenada con prefijos: los documentos se vectorizan como `passage: ...` y las preguntas como `query: ...`. Si te saltas el prefijo, la calidad cae.
- **Disperso** (`Qdrant/bm25`): un vector con una posición por término (tras pasar a minúsculas, quitar *stopwords* y hacer *stemming* en español) y un peso solo en los términos que aparecen. Premia la coincidencia literal: códigos, nombres propios, siglas. Es la mitad "léxica" de la búsqueda híbrida del domingo.

BM25 tiene dos factores: cuánto aparece el término en el fragmento (TF, normalizado por longitud) y lo raro que es en toda la colección (IDF). fastembed calcula **solo la parte TF** al indexar; la parte IDF la calcula **Qdrant** en cada búsqueda, porque es el único que conoce la colección entera. Por eso la colección se crea con `modifier=IDF`.

### 1.4 Qdrant: puntos, vectores con nombre y payload

Un **punto** de Qdrant tiene tres cosas: un `id` (entero o UUID), uno o varios **vectores con nombre** y un **payload** (un JSON arbitrario por el que puedes filtrar). `upsert` significa "inserta o, si ya existe ese `id`, **sustitúyelo entero**". Esa última parte es la protagonista de hoy.

---

## 2. Cómo está en AGENT4U

### 2.1 Quién carga qué: `worker/settings.py`

```python
# worker/settings.py:27-42
ctx["dense_embedder"] = TextEmbedding(model_name="intfloat/multilingual-e5-large")
ctx["sparse_embedder"] = SparseTextEmbedding(model_name="Qdrant/bm25", language="spanish")
ctx["qdrant"] = QdrantClient(url=settings.qdrant_url)

opciones_pdf = PdfPipelineOptions(do_ocr=False, do_table_structure=True)
ctx["converter"] = DocumentConverter(
    format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opciones_pdf)}
)

tokenizer = HuggingFaceTokenizer(
    tokenizer=AutoTokenizer.from_pretrained("intfloat/multilingual-e5-large"),
    max_tokens=500,
)
ctx["chunker"] = HybridChunker(tokenizer=tokenizer)
```

Tres decisiones en diez líneas:

- **`do_ocr=False`**: los PDF con capa de texto se procesan mucho más rápido, pero un PDF **escaneado** (solo imágenes) no produce texto.
- **`do_table_structure=True`**: reconstruye filas y columnas de las tablas. Es caro, pero las preguntas de tipo *tabla* del arnés de evaluación (README, *Evaluación del sistema*) lo necesitan.
- **`max_tokens=500` con el tokenizador de e5**: el chunker cuenta tokens igual que los contará el modelo, y cuenta sobre el texto **contextualizado** (`hybrid_chunker.py`, `_count_chunk_tokens` llama a `contextualize`). 500 + el prefijo `passage: ` (unos 3 tokens) + los 2 tokens especiales de inicio y fin = ~505, por debajo de los 512 del modelo. El margen es pequeño pero suficiente: ningún fragmento se trunca.

### 2.2 `normalize_text`: convertir, trocear y filtrar (`rag/vectorization.py:13-49`)

```python
converted_document = converter.convert(file_path)          # :14  ruta o URL
chunks = chunker.chunk(dl_doc=converted_document.document)  # :15
NOISE_LABELS = {"page_header", "page_footer"}               # :19

for chunk in chunks:
    labels = {item.label.value for item in chunk.meta.doc_items}
    if labels and labels <= NOISE_LABELS:                   # :24  solo cabecera/pie
        continue
    text = chunker.contextualize(chunk)                     # :27
    if len(text) < 100:                                     # :28  demasiado corto
        continue
    pages = sorted(set(prov.page_no for item in chunk.meta.doc_items for prov in item.prov))
    records.append({"texto": text, "nombre": name, "origen": file_path,
                    "texto_crudo": chunk.text, "headings": chunk.meta.headings or [],
                    "paginas": list(pages), "tipo": type,
                    "fecha": datetime.datetime.now().isoformat()})
    texts_to_embed.append(f"passage: {text}")               # :47
```

Devuelve **dos listas paralelas**: `texts_to_embed` (lo que se vectoriza, con prefijo) y `records` (lo que se guarda como payload, sin prefijo). Que vayan en paralelo es frágil: dependen de que nadie añada un `continue` entre los dos `append`.

El payload de cada punto, campo a campo, y quién lo lee hoy:

| Campo | Contenido | ¿Quién lo lee? |
|---|---|---|
| `texto` | Encabezados + texto (lo vectorizado, sin `passage:`) | `retrieval.py:63`, el cross-encoder y el prompt |
| `nombre` | `basename` del origen | `retrieval.py:64`, citas; y `DELETE /documentos/{nombre}` |
| `origen` | Ruta o URL completa | `borrar_por_origen` |
| `texto_crudo` | El texto sin encabezados | **Nadie** (ya está en *Deuda técnica conocida* del README) |
| `headings` | Ruta de encabezados | `retrieval.py:70`, el visor de fuentes del frontend |
| `paginas` | Páginas de procedencia | `retrieval.py:65` y el prompt (`Página: N/A` si está vacío) |
| `tipo` | El `type` de la petición, sin validar | **Nadie** |
| `fecha` | Hora local, sin zona, **distinta en cada fragmento** | **Nadie** |

Y uno que falta: `retrieval.py:66` lee `payload.get("url")` y `prompt.py:41` lo pinta como `Url: ...`, pero **`normalize_text` nunca escribe `url`**. Siempre sale `N/A`, también para lo indexado con `/indexar-url` (donde la URL está en `origen`).

### 2.3 `embed_texts`: vectorizar y subir por lotes (`:86-120`)

```python
asegurar_coleccion(qdrant)                     # :103  crea la colección si no existe
tamano_lote = get_settings().index_lote_upsert # :105  200
densos = dense_embedder.embed(chunks)          # :108  generador
dispersos = sparse_embedder.embed(chunks)      # :109  generador
lote = []
for record, denso, disperso in zip(records, densos, dispersos):
    lote.append(_punto(record, denso, disperso))
    if len(lote) >= tamano_lote:
        qdrant.upsert(collection_name=COLLECTION_NAME, points=lote)
        lote = []
if lote:
    qdrant.upsert(collection_name=COLLECTION_NAME, points=lote)
```

El docstring explica bien el porqué: `embed()` de fastembed devuelve un **generador** (internamente vectoriza en lotes de 256), y `zip` los consume a la vez, así que en memoria solo hay 200 puntos como mucho, sea el documento de 10 páginas o de 1.000. Un vector de 1024 `float` de Python ocupa unas ocho veces más que en `float32` (32.824 frente a 4.096 bytes, dice el comentario), y por eso importa no materializarlos todos.

La colección (`asegurar_coleccion`, `:51-69`):

```python
vectors_config={"dense_vector": VectorParams(size=1024, distance=Distance.COSINE)},
sparse_vectors_config={"sparse_vector": SparseVectorParams(modifier=models.Modifier.IDF)},
```

Dos **vectores con nombre** en cada punto. El nombre es el contrato con `retrieval.py`, que consulta con `using="dense_vector"` y `using="sparse_vector"`.

### 2.4 El id del punto (`:10-11` y `:72-74`)

```python
def id_from_text(text: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, text))
...
PointStruct(id=id_from_text(record["texto"]), ...)
```

`uuid5` es un hash (SHA-1) de un espacio de nombres más un texto: el mismo texto da siempre el mismo UUID. El README lo vende como la garantía de idempotencia (*"reindexar el mismo documento no duplica datos"*). Guárdate esto para la sección 3.

### 2.5 Dos orquestadores para el mismo pipeline

El pipeline (`normalize_text` + `embed_texts`) se llama desde **dos** sitios:

- `worker/jobs.py:45-55` (`_trabajo`): el que se usa en producción.
- `services/indexation_service.py:42-69` (`indexar_documento`): **ningún código de `app/` lo llama**. Solo lo usan `tests/integration/test_indexation_service.py` y los scripts `tests/evaluation/index_all_docs.py` e `index_hard_docs.py`.

Lo he comprobado con `git grep -n indexar_documento`. Es el resto de cuando `/indexar` indexaba dentro de la petición: su docstring todavía habla del *threadpool* y de la sesión que inyecta FastAPI. Y tiene consecuencias: los scripts de evaluación indexan por un camino que **no** hace `borrar_por_origen` antes de vectorizar y que crea la fila en estado `pendiente`, no `en-cola`.

---

## 3. Por qué se montó así (y qué no cuadra)

### Decisiones

1. **Docling y no `pypdf`/`pdfplumber`.** Está en *Decisiones de diseño* del README: la estructura (títulos, tablas, orden de lectura) es lo que permite fragmentos con sentido y citas con página. *Coste:* modelos de ML, minutos por PDF grande y varios cientos de MB de dependencias. *Alternativas:* `unstructured` (parecido, más pesado), o un servicio externo de parsing (mejor con escaneados, pero sacas los documentos de tu máquina).

2. **Chunking estructural y por tokens del propio modelo, en vez de "cada N caracteres con solape".** El troceo por caracteres es trivial pero corta frases y tablas por la mitad, y no sabe nada del límite real del modelo. *Coste:* los fragmentos tienen tamaños muy desiguales (una sección de dos líneas es un fragmento entero), y eso es justo lo que el filtro de 100 caracteres intenta paliar.

3. **Encabezados dentro del texto vectorizado** (`contextualize`). Un párrafo que dice *"se reinicia con el comando X"* no menciona de qué servicio habla; el encabezado *"Reinicio de la API"* sí. Meterlo en el vector mejora la recuperación. *Coste:* el mismo encabezado repetido en muchos fragmentos los acerca entre sí en el espacio vectorial.

4. **Dos vectores (denso + BM25) en el mismo punto**, en vez de dos colecciones. Una sola escritura, un solo id y un solo borrado. Qdrant los combina en una consulta (el domingo). *Coste:* toda la colección se recrea si cambias la dimensión o el modelo de uno de los dos.

5. **`COSINE` en vez de `DOT`.** El README lo explica: los vectores de e5 que da fastembed **no salen normalizados** (lo he comprobado: e5-large está registrado en `fastembed/text/pooled_embedding.py`, que hace *mean pooling* sin normalizar). Qdrant normaliza al insertar con `COSINE`, así que lo que guarda tiene norma 1. Lo vas a medir en el ejercicio.

6. **Subida por lotes de 200.** Memoria constante. *Coste:* durante la indexación, la colección contiene **una parte** del documento, y `search_chunks` no filtra por estado: una pregunta hecha a mitad de la ingesta puede recuperar fragmentos de un documento que la UI todavía muestra como `indexando`.

### Cosas que no cuadran (comprobadas hoy contra `main`)

- 🔴 **Dos documentos con el mismo texto comparten punto, y borrar uno deja al otro sin vectores.** El id es `uuid5(texto)`, y el texto contextualizado no incluye nada del documento: solo encabezados y contenido. El mismo PDF subido por `/indexar-fichero` y por `/indexar` (dos orígenes distintos, así que el 409 no salta), o dos versiones de un manual que comparten capítulos, generan **los mismos ids**. El segundo `upsert` sustituye el punto entero, con su payload. Lo he reproducido con el `embed_texts` real y un Qdrant en memoria:

  ```text
  tras indexar A                    -> 1 puntos ['/docs/informe.pdf']
  tras indexar B (mismo contenido)  -> 1 puntos ['/uploads/informe.pdf']
  tras borrar B                     -> 0 puntos []
  ```

  En SQLite, A sigue en `indexado` con sus `num_chunks`, pero ya no tiene ni un vector: el RAG nunca más lo encontrará y nadie avisa. Hoy lo reproduces y lo arreglas.

- 🔴 **Un fragmento repetido dentro del mismo documento se cuenta dos veces y se guarda una.** Una advertencia que se repite en varias secciones con el mismo nombre, o la misma tabla en dos sitios bajo el mismo encabezado, dan el mismo texto contextualizado y, por tanto, el mismo id. `num_chunks` dice 3 y en Qdrant hay 2. Lo he comprobado pasando por Docling un Markdown con dos secciones `## Aviso` idénticas: 3 fragmentos y 2 ids distintos.

- 🟠 **La idempotencia ya no depende del id.** Desde que existe el worker, `indexar_job` llama a `borrar_por_origen` **antes** de vectorizar (`jobs.py:43`). Eso es lo que impide duplicados al reindexar, incluso si el documento cambió y tiene menos fragmentos (algo que el id por texto nunca resolvió: los fragmentos viejos se quedaban). El id por contenido quedó como herencia del MVP y hoy solo aporta los dos bugs de arriba. Un id por `origen + posición` mantiene el determinismo y no colisiona.

- 🟠 **`indexado` con 0 fragmentos, sin aviso.** Si ningún fragmento pasa los filtros, el trabajo termina bien y la fila queda en `indexado` con `num_chunks = 0`. Pasa con tres casos reales: un PDF **escaneado** (`do_ocr=False`: no hay texto que trocear), un documento cuyo contenido cabe en menos de 100 caracteres (los de prueba del día 05: `'Documento 1\nTexto de prueba del dia 05, documento numero 1.'` mide 59), y una URL que Docling convierte en una página casi vacía. El usuario ve "indexado" y el RAG responde *"No encuentro esa información"*. Debería ser un `error` con un mensaje claro. Fíjate además en que el docstring de `num_chunks` en `schemas.py` dice *"Es 0 mientras el estado no sea 'indexado'"*: también es 0 en este caso, siendo `indexado`.

- 🟠 **El filtro de 100 caracteres mide lo que no debe.** Se aplica sobre el texto **contextualizado**: un párrafo de 30 caracteres bajo encabezados largos pasa, y una línea útil y corta en un documento sin encabezados (*"El código del portal es 4471"*) se descarta. Medir `chunk.text`, o mejor tokens, sería más coherente.

- 🟠 **La configuración de los modelos está escrita dos veces.** `lifespan.py:44-58` y `worker/settings.py:27-41` repiten a mano `"intfloat/multilingual-e5-large"`, `"Qdrant/bm25"`, `"spanish"` y `max_tokens=500`, y `asegurar_coleccion` fija `size=1024`. Si alguien cambia el modelo en el worker y no en la API, las preguntas se vectorizan con otro modelo que los documentos y la búsqueda densa devuelve basura **sin ningún error**. Es el mismo argumento del docstring de `index_max_en_vuelo` (día 05): *"dos copias de un límite son dos copias que acaban discrepando"*. Lo correcto es llevarlo a `Settings` y leer la dimensión del modelo (`TextEmbedding.list_supported_models()` la da).

- 🟡 **`borrar_por_origen` traga cualquier excepción** con un `print` y devuelve `False` (`:147-149`). En el worker se ignora ese `False` dos veces (`jobs.py:43` y `:60`): si Qdrant falla al borrar en el camino de error, quedan vectores parciales de un documento marcado `error`. Además, filtra por `origen` **o** `nombre`, sin índice de payload sobre ninguno de los dos: con pocos miles de puntos da igual; con cientos de miles, cada borrado recorre la colección.

- 🟡 **El `docstring` de `asegurar_coleccion` promete más de lo que hace.** Dice que se llama antes de vectorizar para enterarse de que Qdrant está caído *"en el primer segundo"*. Es antes de los embeddings, sí, pero **después** de Docling, que es la parte cara de un PDF. El primer contacto real con Qdrant es el `borrar_por_origen` de `jobs.py:43`, que traga el error.

- 🟡 **`url` se lee y nunca se escribe; `tipo`, `fecha` y `texto_crudo` se escriben y nunca se leen** (tabla de la sección 2.2). `texto_crudo` duplica casi todo `texto`: en un corpus grande es casi la mitad del payload.

- 🟡 **El README describe un pipeline anterior.** *Cómo funciona el pipeline* cita `id_desde_texto` (el código dice `id_from_text`) y `buscar_chunks` (es `search_chunks`); la tabla de tecnologías dice *"Qdrant (dense, distancia coseno)"*, pero la colección es híbrida. Hoy arreglas la parte de los ids.

- 🟡 **`indexation_service.py` es un segundo orquestador sin uso en producción** (sección 2.5). Tiene sus tests, que prueban un camino que la API no ejecuta, y los scripts de evaluación indexan por él. O se borra y los scripts pasan a llamar a la misma función que el worker, o se convierte en esa función común y `_trabajo` la llama.

---

## 4. Ejercicio (≈40 min): mira los puntos con tus ojos, provoca la colisión y arréglala

**Rama de código:** `ejercicio/dia-06`, creada desde `main`.
**Entrega:** `docs/aprendizaje/entregas/dia-06.md`, en la rama `aprendizaje`, **antes de las 8:30 del domingo 1-nov**.

Primero levantas API y worker en local, con una base y una colección propias, indexas tres documentos pensados para enseñar cada filtro y miras en Qdrant lo que generan. Después provocas la colisión de ids, la arreglas con TDD y compruebas el arreglo en real.

> Necesitas Docker para Qdrant y Redis, y los modelos de fastembed. Si no están en caché (viven en `/tmp/fastembed_cache`, día 05), el primer arranque los descarga: arranca el Paso 2 lo primero y lee mientras.

### Paso 1 — Rama y punto de partida (2 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-06 origin/main
cd backend
uv sync
uv run pytest -q          # punto de partida: 91 passed
```

### Paso 2 — Infraestructura, documentos de prueba, API y worker (5 min)

```bash
cd ~/ruta/AGENT4U
docker compose up -d qdrant redis

mkdir -p /tmp/agent4u-dia06/copia
cat > /tmp/agent4u-dia06/env <<'EOF'
export APP_DB_URL=sqlite:////tmp/agent4u-dia06/dia06.db
export APP_QDRANT_COLLECTION=dia06
EOF

cat > /tmp/agent4u-dia06/manual.md <<'EOF'
# Manual de AGENT4U

## Instalación

Para instalar el sistema necesitas Docker y Docker Compose. Arranca los servicios con docker compose up y espera a que la API responda en el puerto 8000.

## Licencia

Este software se distribuye sin licencia definida. Todos los derechos reservados por el autor del proyecto.
EOF

cat > /tmp/agent4u-dia06/repetido.md <<'EOF'
# Guía de operación

## Aviso

Antes de tocar nada en producción, avisa al equipo de guardia por el canal de incidencias y espera confirmación.

## Reinicio de la API

Para reiniciar la API ejecuta docker compose restart api y comprueba que el endpoint de salud responde con estado ok.

## Aviso

Antes de tocar nada en producción, avisa al equipo de guardia por el canal de incidencias y espera confirmación.
EOF

printf "# Documento corto\n\nEl código del portal es 4471.\n" > /tmp/agent4u-dia06/corto.md
cp /tmp/agent4u-dia06/manual.md /tmp/agent4u-dia06/copia/manual-copia.md
ls -R /tmp/agent4u-dia06
```

**Terminal A** (la API):

```bash
cd ~/ruta/AGENT4U/backend
source /tmp/agent4u-dia06/env
uv run uvicorn app.api.main:app --port 8000
```

**Terminal B** (el worker, con la CLI de ARQ para tener log; día 05):

```bash
cd ~/ruta/AGENT4U/backend
source /tmp/agent4u-dia06/env
uv run arq app.worker.settings.WorkerSettings
```

**Terminal C** (la de trabajo). Espera a la API y define dos ayudas que usarás todo el ejercicio:

```bash
until curl -sf localhost:8000/health; do sleep 3; done; echo

Q=http://localhost:6333/collections/dia06

contar() {
  curl -s -X POST $Q/points/count -H 'Content-Type: application/json' \
    -d "{\"exact\": true, \"filter\": {\"must\": [{\"key\": \"origen\", \"match\": {\"value\": \"$1\"}}]}}"
  echo "   <- $1"
}

documentos() {
  curl -s localhost:8000/documentos | python3 -c \
    "import sys, json; [print(d['name'], d['state'], d['num_chunks']) for d in json.load(sys.stdin)['documentos']]"
}
```

### Paso 3 — Predice, indexa y compara (8 min)

**Antes de lanzar nada**, escribe en la entrega tu predicción: cuántos fragmentos (`num_chunks`) tendrá cada uno de `manual.md`, `repetido.md` y `corto.md`, y cuántos puntos habrá en Qdrant para cada uno. Razónalo con la sección 2.2. No pasa nada si fallas; lo que cuenta es el razonamiento.

Ahora indexa los tres:

```bash
for f in manual repetido corto; do
  curl -s -X POST localhost:8000/indexar -H 'Content-Type: application/json' \
    -d "{\"file_path\": \"/tmp/agent4u-dia06/$f.md\", \"type\": \"md\"}"; echo
done
sleep 15
documentos
contar /tmp/agent4u-dia06/manual.md
contar /tmp/agent4u-dia06/repetido.md
contar /tmp/agent4u-dia06/corto.md
```

Si alguno sigue en `en-cola` o `indexando`, espera unos segundos y repite `documentos`. Lo esperado: `manual.md` 2 y 2, `repetido.md` **3 y 2**, `corto.md` `indexado` con **0 y 0**. Pega la salida y compárala con tu predicción.

### Paso 4 — Abre un punto por dentro (8 min)

Primero, la configuración de la colección (busca `dense_vector`, `sparse_vector`, `size`, `distance`, `modifier` y `points_count`):

```bash
curl -s $Q | python3 -m json.tool
```

Después, un punto de `manual.md` con sus vectores:

```bash
curl -s -X POST $Q/points/scroll -H 'Content-Type: application/json' \
  -d '{"limit": 1, "with_payload": true, "with_vector": true,
       "filter": {"must": [{"key": "nombre", "match": {"value": "manual.md"}}]}}' \
  > /tmp/agent4u-dia06/punto.json

python3 - <<'EOF'
import json, math
p = json.load(open("/tmp/agent4u-dia06/punto.json"))["result"]["points"][0]
print("id:", p["id"])
for clave, valor in p["payload"].items():
    print(f"  {clave}: {str(valor)[:80]!r}")
d = p["vector"]["dense_vector"]
s = p["vector"]["sparse_vector"]
print("denso:", len(d), "dimensiones, norma", round(math.sqrt(sum(x * x for x in d)), 4))
print("disperso:", len(s["indices"]), "terminos, valores", sorted({round(v, 3) for v in s["values"]}))
EOF
```

Y ahora la norma del mismo tipo de vector **antes** de entrar en Qdrant:

```bash
cd ~/ruta/AGENT4U/backend
uv run python -c "
import numpy as np
from fastembed import TextEmbedding
v = next(iter(TextEmbedding('intfloat/multilingual-e5-large').embed(['passage: hola mundo'])))
print('norma en crudo:', np.linalg.norm(v))"
```

Por último, abre `http://localhost:6333/dashboard`, entra en la colección `dia06`, pestaña *Points*, y localiza los 4 puntos. Anota en la entrega qué ves (payload, vectores) y si hay algo que te sorprenda.

### Paso 5 — Provoca la colisión (5 min)

Indexa la copia de `manual.md`, que tiene el mismo contenido y otro origen:

```bash
curl -s -X POST localhost:8000/indexar -H 'Content-Type: application/json' \
  -d '{"file_path": "/tmp/agent4u-dia06/copia/manual-copia.md", "type": "md"}'; echo
sleep 10
documentos
contar /tmp/agent4u-dia06/manual.md
contar /tmp/agent4u-dia06/copia/manual-copia.md
```

Deberías ver los dos documentos en `indexado` con 2 fragmentos cada uno, y en Qdrant **0** puntos para `manual.md` y 2 para la copia. Ahora borra la copia y mira cómo queda el original:

```bash
curl -s -X DELETE localhost:8000/documentos/manual-copia.md; echo
documentos
contar /tmp/agent4u-dia06/manual.md
```

`manual.md` sigue en `indexado` con 2 fragmentos y no tiene ningún vector. Pega todas las salidas.

### Paso 6 — TDD: un id por documento y posición (10 min)

**6.1 El test en rojo.** Crea `backend/tests/unit/test_ids_puntos.py`:

```python
"""Ids de los puntos de Qdrant: uno por fragmento y por documento."""
from app.rag.vectorization import embed_texts

TEXTO = "Licencia\nEste software se distribuye sin licencia definida. " * 2


def _record(origen: str, texto: str = TEXTO) -> dict:
    return {"texto": texto, "nombre": origen.rsplit("/", 1)[-1], "origen": origen}


def test_el_mismo_texto_en_dos_documentos_no_comparte_punto(
    qdrant, dense_embedder, sparse_embedder,
):
    for origen in ("/docs/manual.md", "/uploads/manual-copia.md"):
        embed_texts(
            chunks=[f"passage: {TEXTO}"], dense_embedder=dense_embedder,
            sparse_embedder=sparse_embedder, qdrant=qdrant,
            records=[_record(origen)],
        )

    assert len({p.id for p in qdrant.puntos}) == 2


def test_un_fragmento_repetido_dentro_del_documento_cuenta_dos_veces(
    qdrant, dense_embedder, sparse_embedder,
):
    records = [_record("/docs/guia.md"), _record("/docs/guia.md", "Otro texto " * 20),
               _record("/docs/guia.md")]

    embed_texts(
        chunks=[f"passage: {r['texto']}" for r in records],
        dense_embedder=dense_embedder, sparse_embedder=sparse_embedder,
        qdrant=qdrant, records=records,
    )

    assert len({p.id for p in qdrant.puntos}) == len(records)
```

`FakeQdrant` (en `tests/conftest.py`) acumula en `puntos` todo lo que recibe y no sustituye por id, así que contamos ids **distintos** con un `set`: es lo que haría Qdrant de verdad.

```bash
cd ~/ruta/AGENT4U/backend
uv run pytest -q tests/unit/test_ids_puntos.py     # 2 failed: assert 1 == 2 y assert 2 == 3
```

**6.2 El arreglo**, en `backend/app/rag/vectorization.py`. Son tres cambios.

(a) Sustituye la función `id_from_text` (líneas 10-11) por:

```python
def id_punto(origen: str, posicion: int) -> str:
    """Id determinista del punto: el documento y la posicion del fragmento.

    Antes era uuid5 del texto. Dos documentos con el mismo fragmento (el mismo
    PDF subido por dos rutas, dos versiones de un manual) compartian punto: el
    segundo `upsert` pisaba el payload del primero y borrar uno dejaba al otro
    sin vectores. La idempotencia ya no depende del id: el worker borra por
    origen antes de vectorizar.
    """
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{origen}#{posicion}"))
```

(b) En `_punto`, añade el parámetro y cambia el id:

```python
def _punto(record: dict, denso, disperso, posicion: int) -> PointStruct:
    return PointStruct(
        id=id_punto(record["origen"], posicion),
```

(el resto de `_punto` queda igual).

(c) En `embed_texts`, numera los fragmentos:

```python
    for posicion, (record, denso, disperso) in enumerate(zip(records, densos, dispersos)):
        lote.append(_punto(record, denso, disperso, posicion))
```

```bash
uv run pytest -q tests/unit/test_ids_puntos.py     # 2 passed
git grep -n id_from_text                           # no debe salir nada
```

**6.3 El README.** Tres frases del README describen el id por texto. Este script las cambia y falla si no encuentra alguna:

```bash
cd ~/ruta/AGENT4U
python3 - <<'EOF'
from pathlib import Path

p = Path("README.md")
s = p.read_text(encoding="utf-8")
cambios = [
    (
        "los IDs son deterministas (`uuid5` sobre el texto del chunk), así que reindexar el mismo documento no duplica datos.",
        "el worker borra los puntos del origen antes de vectorizar, y los IDs son deterministas (`uuid5` de origen + posición), así que reindexar no duplica datos y dos documentos con el mismo texto no comparten punto.",
    ),
    (
        "con un ID determinista, calculado a partir del propio texto del chunk. Esto hace que reindexar el mismo documento sea idempotente en lugar de duplicar datos:",
        "con un ID determinista calculado a partir del origen del documento y la posición del fragmento. La idempotencia la da el borrado por origen que hace el worker antes de vectorizar; el ID solo evita que dos documentos con el mismo texto compartan punto:",
    ),
    (
        "def id_desde_texto(texto: str) -> str:\n    return str(uuid.uuid5(uuid.NAMESPACE_DNS, texto))",
        'def id_punto(origen: str, posicion: int) -> str:\n    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{origen}#{posicion}"))',
    ),
]
for viejo, nuevo in cambios:
    assert s.count(viejo) == 1, f"No encuentro: {viejo[:60]}"
    s = s.replace(viejo, nuevo)
p.write_text(s, encoding="utf-8")
print("README actualizado")
EOF
git diff --stat README.md        # 4 insertions(+), 4 deletions(-)
```

### Paso 7 — Compruébalo en real (5 min)

El worker tiene el código viejo cargado: páralo con `Ctrl+C` en la terminal B y vuelve a lanzarlo (`uv run arq app.worker.settings.WorkerSettings`). En la terminal C, borra y reindexa:

```bash
curl -s -X DELETE localhost:8000/documentos/manual.md; echo
curl -s -X DELETE localhost:8000/documentos/repetido.md; echo
for f in manual.md repetido.md copia/manual-copia.md; do
  curl -s -X POST localhost:8000/indexar -H 'Content-Type: application/json' \
    -d "{\"file_path\": \"/tmp/agent4u-dia06/$f\", \"type\": \"md\"}"; echo
done
sleep 15
documentos
contar /tmp/agent4u-dia06/manual.md
contar /tmp/agent4u-dia06/copia/manual-copia.md
contar /tmp/agent4u-dia06/repetido.md
```

Ahora debería salir 2, 2 y **3**: cada documento tiene sus puntos, y `num_chunks` coincide con lo que hay en Qdrant. Apaga todo:

```bash
# Ctrl+C en las terminales A y B
docker compose stop qdrant redis
```

### Paso 8 — Validar y subir (2 min)

```bash
cd ~/ruta/AGENT4U/backend
uv run pytest -q                  # 93 passed
uv run ruff check app tests       # All checks passed!
cd ..
git add backend/app/rag/vectorization.py backend/tests/unit/test_ids_puntos.py README.md
git diff --cached --stat          # 3 ficheros, ni uno más
git commit -m "fix(ingesta): id de punto por origen y posicion; dos documentos ya no comparten vectores"
git push -u origin ejercicio/dia-06
```

### Preguntas (responde con tus palabras en la entrega)

1. Cuenta qué le pasa a `repetido.md` desde `converter.convert` hasta el `upsert`: cuántos fragmentos salen del chunker, qué devuelve `contextualize` para cada uno, por qué pasan el filtro y por qué en Qdrant quedaban 2 puntos antes del arreglo.
2. ¿Por qué `corto.md` acaba en `indexado` con 0 fragmentos? ¿Qué estado debería tener y qué mensaje le pondrías? ¿En qué otros dos casos reales pasa lo mismo?
3. Compara la norma del vector que leíste en Qdrant con la norma en crudo de fastembed. ¿Por qué son distintas? ¿Qué pasaría con el ranking si la colección usara `DOT` sin normalizar?
4. Mira los valores del vector disperso del Paso 4. ¿Por qué casi todos son iguales? ¿Dónde está la parte IDF de BM25 y por qué no la calcula fastembed al indexar?
5. El id nuevo depende de la **posición**. Si reindexas un documento que cambió y ahora tiene un fragmento más al principio, todos los ids se desplazan. ¿Es un problema? Razónalo mirando `jobs.py:43`. ¿Y por el camino de `indexation_service.py`, que usan los scripts de evaluación?
6. `max_tokens=500` y e5 admite 512. Explica de dónde salen los tokens que faltan. ¿Qué pasaría si alguien subiera `max_tokens` a 512 "para aprovechar el modelo"?
7. Los nombres del modelo están escritos a mano en `lifespan.py` y en `worker/settings.py`. Describe el fallo que se produciría si solo se cambiara uno de los dos, y cómo lo evitarías con `Settings` (día 02).

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-06` en el remoto, creada desde `main` (`git merge-base --is-ancestor origin/main origin/ejercicio/dia-06`).
- [ ] Paso 3: predicción escrita **antes** de la salida, y salida pegada con `repetido.md` 3/2 y `corto.md` `indexado` 0/0.
- [ ] Paso 4: configuración de la colección, el payload de un punto, la norma en Qdrant, la norma en crudo y el número de términos del vector disperso.
- [ ] Paso 5: salidas que muestran `manual.md` con 0 puntos tras indexar la copia, y en `indexado` sin vectores tras borrarla.
- [ ] Paso 6.1: resumen de pytest con los 2 tests en rojo **antes** del arreglo.
- [ ] `id_from_text` ya no existe (`git grep` vacío) y `embed_texts` usa `id_punto(origen, posicion)`.
- [ ] Paso 7: tras el arreglo, 2, 2 y 3 puntos.
- [ ] `uv run pytest -q` → `93 passed` y `uv run ruff check app tests` limpio (pega los resúmenes).
- [ ] `git diff --stat origin/main origin/ejercicio/dia-06` muestra solo `vectorization.py`, `test_ids_puntos.py` y `README.md`.
- [ ] Las 7 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

Entrega (antes de las 8:30 del **domingo 1-nov**):

```bash
git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-06.md
# ...rellena dia-06.md: predicción, salidas de los pasos 3-7, resúmenes de pytest y ruff, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-06.md
git commit -m "entrega día 06" && git push
```

Si quieres feedback antes de entregar, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code con `XX = 06`, estando en tu rama `ejercicio/dia-06`.

---

## 5. Para profundizar (opcional)

- Docling, *Chunking* (`HierarchicalChunker` y `HybridChunker`, `contextualize`, `merge_peers`): https://docling-project.github.io/docling/concepts/chunking/
- Qdrant, *Points* y *Vectors* (vectores con nombre, vectores dispersos y el modificador IDF): https://qdrant.tech/documentation/concepts/vectors/

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la segunda mitad de la sección *4. Ingesta asíncrona: cola, worker y vectorización* debería cubrir:

- La cadena Docling → `HybridChunker` → filtros → fastembed → `upsert` por lotes, y qué carga el worker en `startup` para hacerla.
- Por qué el chunker usa el tokenizador de e5 con `max_tokens=500`, y qué aporta `contextualize`.
- Qué es un punto en AGENT4U: los dos vectores con nombre, el payload (qué campos se usan y cuáles sobran) y cómo se calcula ahora el id.
- Cómo se garantiza la idempotencia (borrado por origen antes de vectorizar) y por qué el id por texto no bastaba.
- Los huecos abiertos: `indexado` con 0 fragmentos, modelos configurados en dos sitios y el orquestador duplicado de `indexation_service.py`.

**El domingo 1-nov (día 07, sesión larga):** la otra mitad de lo que hoy has guardado. `search_chunks` lanza dos búsquedas a la vez (densa y BM25), las funde con RRF, reordena con el cross-encoder de Jina y se queda con `max_fragmentos`. Veremos por qué la pregunta pasa por BM25 con `embed` y no con `query_embed`, y medirás cómo cambian las respuestas al variar `max_fragmentos`.
