# Píldora 07 — Recuperación híbrida (densa + BM25 + RRF) y reranking

**Domingo 1-nov-2026 · sesión larga: 30 min de lectura + 2-2,5 h de ejercicio**

## 0. Crítica de la entrega del día 06

No hay entrega del día 06: en `origin/aprendizaje` no existe `entregas/dia-06.md` y en el remoto no hay rama `ejercicio/dia-06`. Tampoco han llegado tarde la 02, la 03, la 04 ni la 05. Sin nota.

Una cosa práctica: el ejercicio de hoy reutiliza el montaje de los días 05 y 06 (API y worker en local con una base y una colección aparte). Si te pones con él, ya tienes ese montaje rodado para recuperar el 06, que es el que arregla la colisión de ids.

`main` sigue en `fb93eea` (21-oct). Todo lo que sigue está comprobado contra ese código. Lo que digo de Qdrant y fastembed lo he comprobado contra las versiones que fija `backend/uv.lock` (`qdrant-client 1.18.0`, `fastembed 0.8.0`, `langgraph 1.2.11`) y contra la imagen `qdrant/qdrant:v1.19.0` de `docker-compose.yml`.

---

## 1. Concepto clave: encontrar los fragmentos buenos entre miles

El viernes guardaste cada fragmento con dos vectores. Hoy, la otra mitad: dada una pregunta, ¿qué fragmentos llegan al LLM? Es la pieza que más decide la calidad de un RAG. Si el fragmento con la respuesta no llega, el mejor modelo del mundo contesta *"No encuentro esa información"*.

### 1.1 Dos formas de buscar, dos formas de fallar

- **Búsqueda densa** (e5, coseno). La pregunta se convierte en un vector de 1024 dimensiones y se buscan los fragmentos más cercanos. Entiende sinónimos y paráfrasis: *"la aplicación no responde"* queda cerca de *"el servicio se queda colgado"*. **Falla** con lo literal: un código de error como `E-4471`, un nombre propio raro o una sigla. Para el modelo, `E-4471` y `E-4417` son casi el mismo vector.
- **Búsqueda léxica** (BM25). Puntúa por términos compartidos, ponderados por lo raros que son en la colección (IDF). Clava los códigos y los nombres. **Falla** con las paráfrasis: si la pregunta dice *"colgada"* y el documento *"no contesta"*, no comparten ni un término.

Fallan en sitios distintos, así que combinarlas cubre más casos que cualquiera de las dos sola. A eso se le llama **búsqueda híbrida**.

### 1.2 Cómo se combinan: RRF

El problema de combinar es que las puntuaciones no son comparables. El coseno va de -1 a 1 (en la práctica, 0,7-0,9 con e5). BM25 no tiene techo y depende del tamaño del corpus. Sumarlas no tiene sentido.

**Reciprocal Rank Fusion** ignora las puntuaciones y solo mira **las posiciones**. Cada lista aporta a cada documento `1 / (k + posición)`, y se suman:

```text
rrf(d) = Σ  1 / (k + pos_lista(d))        pos empieza en 0 en Qdrant
```

Un documento que sale 1.º en una lista y 3.º en la otra suma más que uno que sale 1.º solo en una. Funciona sin calibrar nada, y por eso es el método por defecto en casi todos los motores.

La `k` controla cuánto pesa la cabeza de la lista frente a la cola:

| posición | k = 2 (Qdrant por defecto) | k = 60 (el valor del artículo original) |
|---|---|---|
| 0 | 0,500 | 0,0167 |
| 1 | 0,333 | 0,0164 |
| 2 | 0,250 | 0,0161 |
| 9 | 0,091 | 0,0145 |

Con `k = 2`, ser el primero de una lista vale **cinco veces más** que ser el décimo: manda la cabeza. Con `k = 60`, la diferencia es mínima: manda **estar en las dos listas**. Esta es la primera cosa importante de hoy: **Qdrant usa `k = 2` por defecto, no 60**. Lo dice su documentación (*"k is a constant (set to 2 by default)"*) y el código fuente (`DEFAULT_RRF_K: usize = 2`). Muchos tutoriales dan por hecho el 60. Lo vas a comprobar con tus propios números.

Desde Qdrant 1.16 se puede fijar `k` (`models.Rrf(k=60)`), y desde la 1.17, dar **pesos** a cada lista (`models.Rrf(weights=[...])`, en el orden de los `prefetch`). Tu servidor es la 1.19, así que tienes las dos cosas.

### 1.3 Reordenar: bi-encoder frente a cross-encoder

e5 es un **bi-encoder**: vectoriza pregunta y fragmento **por separado** y luego compara los vectores. Es rápido porque los fragmentos se vectorizan una vez, al indexar. Pero el modelo nunca ve la pregunta y el fragmento juntos.

Un **cross-encoder** (aquí, `jinaai/jina-reranker-v2-base-multilingual`) recibe el par `(pregunta, fragmento)` en una sola entrada y devuelve una puntuación de relevancia. Es mucho más preciso, porque la atención cruza las palabras de los dos textos, y mucho más caro: una pasada completa del modelo **por cada par**, en cada pregunta. No sirve para buscar en 100.000 fragmentos, pero sí para reordenar 20.

De ahí el patrón de **dos etapas** que verás en el código: una recuperación barata y amplia (híbrida, 20 candidatos) y un reordenado caro y preciso (cross-encoder, se queda con los N mejores).

Un detalle que importa mañana: fastembed devuelve la salida **cruda** del modelo (`_post_process_onnx_output` hace `float(elem)` sin sigmoide). Es un *logit*: no está acotado y puede ser negativo. Por encima de 0, el modelo cree que el fragmento es relevante; por debajo, que no. Solo es comparable **dentro de la misma pregunta**.

### 1.4 Asimetría: preguntas y documentos no se vectorizan igual

- **e5** se entrenó con prefijos: `passage: ` para documentos y `query: ` para preguntas. fastembed **no** los pone: su `query_embed` por defecto llama a `embed` tal cual (`text_embedding_base.py`). Por eso el código los pone a mano, y está bien.
- **BM25** también es asimétrico. Al indexar, cada término del fragmento recibe su peso TF normalizado por la longitud del documento (`_term_frequency`, día 06). La pregunta no es un documento: en BM25 clásico, cada término de la pregunta cuenta una vez y la puntuación sale de **sumar el peso del documento** para cada término. Eso es justo lo que hace `query_embed` de fastembed: peso `1.0` a cada término, sin repetir (lo dice su docstring: *"we don't need to use weights in the query"*).

---

## 2. Cómo está en AGENT4U

### 2.1 Quién llama a quién

```text
POST /preguntar  (routers/query.py:50-121)
  └─ query_service.responder(..., max_fragmentos)        valida tope; pasa al grafo
       └─ grafo.stream(entrada)                            LangGraph (día 08)
            reformular → multiconsulta → repartir ──Send──▶ buscar (una rama por subconsulta)
                                                              └─ search_chunks(...)   rag/retrieval.py:35
                                                                   ├─ 2 embeddings de la pregunta
                                                                   ├─ qdrant.query_points: 2 prefetch + RRF
                                                                   └─ cross_encode: reranker + recorte
            ──▶ fusionar (junta ramas, presupuesto 9) ──▶ evaluar ──▶ construir
```

Los cuatro modelos y el cliente de Qdrant se cargan una vez en `lifespan.py:44-47` y viajan al grafo como argumentos de `crear_grafo` (`lifespan.py:64-70`). `search_chunks` no sabe nada de FastAPI: recibe las dependencias como parámetros, y por eso se puede probar con dobles.

### 2.2 `search_chunks` (`rag/retrieval.py:35-74`)

```python
query_vector_dense = next(iter(dense_embedder.embed([f"query: {query}"])))   # :36
query_vector_sparse = next(iter(sparse_embedder.embed([query])))             # :37

query_result = qdrant.query_points(
    collection_name=COLLECTION_NAME,
    prefetch= [
        models.Prefetch(query=models.SparseVector(...), using="sparse_vector", limit = 20),  # :42-49
        models.Prefetch(query=query_vector_dense.tolist(), using="dense_vector", limit = 20), # :50-54
    ],
    query=models.RrfQuery(rrf=models.Rrf()),    # :56  k por defecto = 2
    limit=20,                                   # :57
    with_payload=True,
).points
```

Una sola llamada HTTP a Qdrant hace las dos búsquedas y la fusión. Los `prefetch` son subconsultas que el servidor ejecuta primero; la `query` de fuera (RRF) trabaja sobre sus resultados. Si un fragmento sale en las dos listas, cuenta una sola vez, con las dos aportaciones sumadas. Así que llegan entre 20 y 40 candidatos distintos a la fusión, y salen 20.

Fíjate en el orden: **BM25 primero, densa después**. Da igual con pesos iguales, pero si algún día pones `weights`, el primer peso es el de BM25.

### 2.3 `cross_encode` (`:6-32`)

```python
scores = list(cross_encoder.rerank(query=query, documents=documents))   # :7
ranked = sorted(zip(documents, scores, files, pages, urls, headings),
                key=lambda x: x[1], reverse=True)                        # :11-15
for doc, score, file, page, url, heading in ranked[:max_fragmentos]:     # :20
    ranked_results.append({"chunk": doc, "nombre": file, "paginas": page,
                           "url": url, "headings": heading, "score": float(score)})
```

Reordena los 20 candidatos por el logit del reranker y se queda con `max_fragmentos`. La puntuación RRF se tira: a partir de aquí solo existe `score`, que es el logit. Ese `score` es el que usa `nodo_evaluar` (`grafo_nodes.py:68-74`) para decidir si el contexto es pobre (`mejor_score <= 0`), y el que el frontend enseña en el panel de fuentes.

### 2.4 Lo que pasa con `max_fragmentos` por el camino

El día 03 viste el contrato: `QueryRequest.max_fragmentos` (`schemas.py:33-43`), con `ge=1`, y un 422 si pasa de `APP_MAX_FRAGMENTOS_TOPE` (`query.py:98-102`). El frontend tiene un control deslizante en *Ajustes* (`AjustesConsultaSeccion.tsx`) que lo manda en cada pregunta. Sigámoslo:

1. `query_service.py:60-63` lo mete en el estado inicial del grafo **solo si viene**.
2. `nodo_buscar` lo lee con `estado.get("max_fragmentos", 10)` (`grafo_nodes.py:62`).
3. Pero `nodo_buscar` no se ejecuta con el estado global: lo lanza `repartir` con un `Send` (`:37-41`):

   ```python
   return [Send("buscar", {"consulta_busqueda": subconsulta})
           for subconsulta in estado["subconsultas"]]
   ```

   En LangGraph, `Send(nodo, carga)` ejecuta el nodo con **esa carga como estado, y nada más**. `max_fragmentos` no está en la carga, así que `estado.get(...)` devuelve siempre el 10 por defecto. Lo he comprobado con un grafo mínimo y la misma versión de LangGraph:

   ```text
   buscar recibe: {'consulta_busqueda': 'a'} -> max_fragmentos = 10
   buscar recibe: {'consulta_busqueda': 'b'} -> max_fragmentos = 10
   estado global max_fragmentos = 3
   ```

4. Y aunque llegara, `nodo_fusionar` tiene `presupuesto = 9` escrito a mano (`:116`): nunca pasan más de 9 fragmentos al prompt.

Resultado: **el control deslizante de *Ajustes* no hace nada.** Pidas 2 o 20, cada rama recorta a 10 y la fusión a 9. Y `APP_MAX_FRAGMENTOS_DEFECTO` tampoco: `git grep max_fragmentos_defecto -- backend/app` solo lo encuentra en `config.py:22` y en `query.py:44`, donde `GET /ajustes` **lo anuncia** al frontend. Nadie lo aplica. El día 03 predijiste el JSON de `/ajustes`; hoy sabes que uno de sus números es decorativo.

Este es el arreglo de hoy.

---

## 3. Por qué se montó así (y qué no cuadra)

### Decisiones

1. **Híbrida en vez de solo densa.** El corpus objetivo son documentos técnicos y administrativos, llenos de códigos, nombres de servicios y siglas: el terreno donde la densa falla. *Coste:* un segundo vector por fragmento, un segundo embedding por pregunta (BM25 es barato: tokenizar y hacer *stemming*) y una colección que hay que recrear si cambias cualquiera de los dos modelos. *Alternativa:* un modelo que dé denso y disperso a la vez (BGE-M3, lo comparaste el día 01), o un disperso aprendido como SPLADE, que sí entiende algo de sinónimos.

2. **RRF en vez de una combinación lineal** (`α·denso + (1-α)·bm25`). La combinación lineal necesita normalizar las puntuaciones y calibrar `α` con un conjunto de evaluación; RRF funciona de serie. *Coste:* tira la información de las puntuaciones. Un fragmento con coseno 0,95 y otro con 0,71 valen lo mismo si están en posiciones consecutivas.

3. **Fusión en el servidor, en una sola llamada.** La alternativa era hacer dos `query_points` y fusionar en Python: dos viajes de red y código propio que mantener. *Coste:* el comportamiento depende de la versión de Qdrant (la `k` por defecto, los pesos) y no se ve en el código. Que `models.Rrf()` sin argumentos signifique `k = 2` no lo sabe nadie que lea `retrieval.py`.

4. **Reranker sobre 20 candidatos.** 20 es un compromiso entre *recall* (cuántas oportunidades tiene el fragmento bueno de entrar) y latencia (cada candidato es una pasada del cross-encoder en CPU). *Coste:* con la multiconsulta, cada pregunta abre 2-3 ramas, y cada rama reordena sus 20. Lo verás en el campo `ms` del evento `paso` de `buscar` (día 09).

5. **Jina v2 como reranker**, multilingüe y con ventana de 1.024 tokens. Es de los pocos rerankers que fastembed sirve en ONNX y que entienden bien el español.

### Cosas que no cuadran (comprobadas hoy contra `main`)

- 🔴 **`max_fragmentos` y `APP_MAX_FRAGMENTOS_DEFECTO` no tienen efecto** (sección 2.4). Hay un contrato documentado, una validación con 422, un endpoint que publica el valor, un control en la UI y un test en el gateway, y el número muere en un `Send`. Es un fallo silencioso de los peores: todo parece funcionar. Ningún test lo detecta porque `test_grafo_nodes.py` prueba `fusionar` suelto, con `presupuesto = 9` como comportamiento esperado, y nadie prueba el grafo compilado de punta a punta.

- 🟠 **La licencia del reranker es no comercial.** fastembed registra `jinaai/jina-reranker-v2-base-multilingual` con `license="cc-by-nc-4.0"` (`onnx_text_cross_encoder.py`). Para un proyecto personal o de portfolio, ningún problema. Si AGENT4U acaba en un cliente o en un producto de pago, hay que cambiarlo (por ejemplo, a `BAAI/bge-reranker-v2-m3`, Apache 2.0) o pagar la licencia. No está en el README, y debería.

- 🟠 **La `k` de RRF es implícita y quizá no es la que quieres.** Con `k = 2` manda la cabeza de cada lista: el 1.º de BM25 (que puede ser un fragmento que solo repite una palabra de la pregunta) entra casi seguro entre los 20, aunque la densa ni lo vea. Como después reordena el cross-encoder, el daño es limitado: RRF solo decide **quién entra en los 20**, no el orden final. Aun así, debería ser una decisión explícita en `Settings` y no un valor por defecto de otra librería.

- 🟠 **Todo el embudo está escrito a mano en tres sitios que deben cuadrar**: `limit = 20` en los dos `prefetch` y en la fusión (`retrieval.py:48,53,57`), `max_fragmentos_tope = 20` en `config.py:23` y `presupuesto = 9` en `grafo_nodes.py:116`. Si subes el tope a 30, el reranker solo tiene 20 candidatos y `max_fragmentos = 30` devuelve 20 sin avisar. Pedir 20 hoy equivale a "no filtres nada, solo reordena".

- 🟡 **La pregunta pasa por BM25 con `embed` y no con `query_embed`** (`:37`). Con `embed`, la pregunta se trata como un documento corto: cada término recibe el peso TF normalizado por longitud. Para una pregunta sin palabras repetidas, todos los términos reciben el **mismo** peso (~1,68 para una pregunta de dos términos útiles, en vez de 1,0), así que el orden de BM25 no cambia, y RRF solo mira el orden. Hoy el efecto práctico es casi nulo; solo cambia algo cuando la pregunta repite un término. Pero es la API equivocada, y el día que cambies a un disperso aprendido (SPLADE, `Qdrant/bm42`), donde `query_embed` y `embed` hacen cosas distintas de verdad, se rompe sin avisar. Se arregla con una línea.

- 🟡 **Las puntuaciones del reranker se comparan entre ramas.** `nodo_fusionar` ordena por `score` fragmentos que vienen de subconsultas distintas. Un logit de 2,1 para la subconsulta A y uno de 1,8 para la B no son estrictamente comparables, porque son preguntas distintas. La cuota por rama de `fusionar` lo mitiga. Lo vemos el martes con el grafo.

- 🟡 **No hay umbral de relevancia.** Siempre llegan `max_fragmentos` al prompt, aunque los últimos tengan logits de -5. Los fragmentos irrelevantes no son gratis: ocupan tokens y empujan al modelo a citarlos. `nodo_evaluar` mira el **mejor** score para decidir si reescribe la pregunta, pero nunca descarta los malos.

- 🟡 **No se filtra por estado del documento.** Lo viste el viernes: un documento a medio indexar ya aparece en las búsquedas. Un `filter` por un campo de payload `estado` en el `query_points` lo resolvería, si el worker lo actualizara al terminar.

- 🟡 **Detalles menores en `retrieval.py`:** `search_chunks` está anotada `-> list[str]` y devuelve `list[dict]`; `url` siempre es `None` (día 06); y `cross_encode` recibe seis listas paralelas (`documents`, `files`, `pages`, `urls`, `headings` y los scores) que dependen de que nadie las desordene, cuando bastaría con pasarle los puntos.

- 🟡 **Documentación desactualizada.** El README (*Recuperación*) dice `buscar_chunks()` y solo explica la parte densa: ni BM25, ni RRF, ni el reranker. La ficha de tecnologías del sitio editorial (`frontend/src/sitio/datos/tecnologias.ts`) dice que el cross-encoder es `bge-reranker` (es Jina) y que FastEmbed es la `0.4` (el lock fija la `0.8.0`). Hoy arreglas el README; el sitio, el día 21.

---

## 4. Ejercicio (sesión larga, 2-2,5 h): mira el embudo por dentro y haz que `max_fragmentos` funcione

**Rama de código:** `ejercicio/dia-07`, creada desde `main`.
**Entrega:** `docs/aprendizaje/entregas/dia-07.md`, en la rama `aprendizaje`, **antes de las 8:30 del martes 3-nov**.

Tres partes. En la **A** (≈1 h) indexas un corpus pequeño pensado para que la búsqueda densa y BM25 discrepen, y miras cada etapa del embudo con un script de diagnóstico. En la **B** (≈30 min) calculas RRF a mano, descubres la `k` y juegas con `k` y con los pesos. En la **C** (≈45 min) arreglas `max_fragmentos` con TDD.

> Necesitas Docker (Qdrant y Redis) y los cuatro modelos de fastembed en caché. Si los descargaste en días anteriores, están en `/tmp/fastembed_cache`; si no, el primer arranque los descarga (son unos 3,5 GB). Arranca el Paso 2 lo primero y lee mientras.

### Paso 1 — Rama y punto de partida (5 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-07 origin/main
cd backend
uv sync
uv run pytest -q          # punto de partida: 91 passed
```

### Paso 2 — Infraestructura, corpus, API y worker (15 min)

```bash
cd ~/ruta/AGENT4U
docker compose up -d qdrant redis

mkdir -p /tmp/agent4u-dia07
cat > /tmp/agent4u-dia07/env <<'EOF'
export APP_DB_URL=sqlite:////tmp/agent4u-dia07/dia07.db
export APP_QDRANT_COLLECTION=dia07
EOF

cat > /tmp/agent4u-dia07/servicios.md <<'EOF'
# Operación de AGENT4U

## Reinicio de la API

Para reiniciar la API ejecuta docker compose restart api y comprueba que el endpoint de salud /health responde con estado ok antes de dar el servicio por recuperado.

## Puertos de los servicios

La API escucha en el puerto 8000, el gateway GraphQL en el 8080, Qdrant en el 6333 y Redis en el 6379. El frontend se sirve con nginx en el puerto 80.
EOF

cat > /tmp/agent4u-dia07/incidencias.md <<'EOF'
# Registro de incidencias

## Error E-4471

El error E-4471 aparece cuando el worker de indexación no consigue conectar con Redis al arrancar. Revisa la variable APP_REDIS_URL y que el contenedor de Redis esté sano.

## La aplicación se queda colgada

Si la aplicación deja de contestar y las peticiones se quedan esperando sin respuesta, vuelve a arrancar el contenedor del backend y vigila el consumo de memoria del proceso.
EOF

cat > /tmp/agent4u-dia07/vacaciones.md <<'EOF'
# Política de vacaciones

## Solicitud

Las vacaciones se solicitan con quince días de antelación a través del portal del empleado. El responsable del equipo tiene cinco días laborables para aprobarlas o rechazarlas.

## Días de libre disposición

Cada persona dispone de tres días de libre disposición al año, que no se acumulan de un año a otro y que se piden por el mismo portal que las vacaciones.
EOF
ls /tmp/agent4u-dia07
```

**Terminal A** (la API):

```bash
cd ~/ruta/AGENT4U/backend
source /tmp/agent4u-dia07/env
uv run uvicorn app.api.main:app --port 8000
```

**Terminal B** (el worker):

```bash
cd ~/ruta/AGENT4U/backend
source /tmp/agent4u-dia07/env
uv run arq app.worker.settings.WorkerSettings
```

**Terminal C** (la de trabajo):

```bash
until curl -sf localhost:8000/health; do sleep 3; done; echo
cd ~/ruta/AGENT4U/backend
source /tmp/agent4u-dia07/env

documentos() {
  curl -s localhost:8000/documentos | python3 -c \
    "import sys, json; [print(d['name'], d['state'], d['num_chunks']) for d in json.load(sys.stdin)['documentos']]"
}
```

### Paso 3 — Indexa (5 min)

```bash
for f in servicios incidencias vacaciones; do
  curl -s -X POST localhost:8000/indexar -H 'Content-Type: application/json' \
    -d "{\"file_path\": \"/tmp/agent4u-dia07/$f.md\", \"type\": \"md\"}"; echo
done
sleep 20
documentos
curl -s localhost:6333/collections/dia07 | python3 -c "import sys, json; print('puntos:', json.load(sys.stdin)['result']['points_count'])"
```

Lo esperado: los tres en `indexado` con 2 fragmentos cada uno y 6 puntos en la colección. Si alguno sigue en `en-cola`, espera y repite `documentos`.

### Paso 4 — El embudo etapa a etapa (35 min)

Este script hace a mano lo que hace `search_chunks`, pero enseñándote cada etapa: las 8 primeras de la densa, las 8 de BM25, la fusión RRF (con la posición que tenía cada fragmento en cada lista) y el reordenado del cross-encoder. No se sube a tu rama: vive en `/tmp`.

```bash
cat > /tmp/agent4u-dia07/etapas.py <<'EOF'
"""Recuperacion de AGENT4U etapa a etapa: densa, BM25, RRF y reranker.

Uso (desde backend/, con APP_QDRANT_COLLECTION apuntando a tu coleccion):
    uv run python /tmp/agent4u-dia07/etapas.py "tu pregunta" [k_rrf] [peso_denso] [peso_disperso]
"""
import sys

from fastembed import SparseTextEmbedding, TextEmbedding
from fastembed.rerank.cross_encoder import TextCrossEncoder
from qdrant_client import QdrantClient, models

from app.core.config import get_settings
from app.rag.vectorization import COLLECTION_NAME

N = 8  # candidatos por etapa; en produccion son 20


def corto(payload: dict) -> str:
    texto = payload["texto"].replace("\n", " | ")
    return f"{payload['nombre']:<18} {texto[:60]}"


def main() -> None:
    pregunta = sys.argv[1]
    k = int(sys.argv[2]) if len(sys.argv) > 2 else None
    # Los pesos van en el orden de los prefetch: primero BM25, luego densa.
    pesos = [float(sys.argv[4]), float(sys.argv[3])] if len(sys.argv) > 4 else None

    qdrant = QdrantClient(url=get_settings().qdrant_url)
    dense = TextEmbedding("intfloat/multilingual-e5-large")
    sparse = SparseTextEmbedding("Qdrant/bm25", language="spanish")
    reranker = TextCrossEncoder("jinaai/jina-reranker-v2-base-multilingual")

    v_denso = next(iter(dense.embed([f"query: {pregunta}"]))).tolist()
    v_disp = next(iter(sparse.query_embed(pregunta)))
    v_disp = models.SparseVector(indices=v_disp.indices.tolist(), values=v_disp.values.tolist())

    def buscar(query, using):
        return qdrant.query_points(COLLECTION_NAME, query=query, using=using, limit=N, with_payload=True).points

    densos, dispersos = buscar(v_denso, "dense_vector"), buscar(v_disp, "sparse_vector")
    pos_d = {p.id: i for i, p in enumerate(densos)}
    pos_s = {p.id: i for i, p in enumerate(dispersos)}

    print(f"\nPREGUNTA: {pregunta}   (RRF k={k or 'por defecto'}, pesos [bm25, densa]={pesos or 'iguales'})")
    print("\n== 1. Densa (coseno) ==")
    for i, p in enumerate(densos):
        print(f"  d{i}  {p.score:7.4f}  {corto(p.payload)}")
    print("\n== 2. BM25 (TF del fragmento x IDF de Qdrant) ==")
    for i, p in enumerate(dispersos):
        print(f"  s{i}  {p.score:7.4f}  {corto(p.payload)}")

    rrf = models.Rrf(k=k, weights=pesos) if (k or pesos) else models.Rrf()
    fusion = qdrant.query_points(
        COLLECTION_NAME,
        prefetch=[
            models.Prefetch(query=v_disp, using="sparse_vector", limit=N),
            models.Prefetch(query=v_denso, using="dense_vector", limit=N),
        ],
        query=models.RrfQuery(rrf=rrf),
        limit=N,
        with_payload=True,
    ).points
    print("\n== 3. RRF (posiciones desde 0: d = densa, s = BM25, - = no aparece) ==")
    for i, p in enumerate(fusion):
        d, s = pos_d.get(p.id, "-"), pos_s.get(p.id, "-")
        print(f"  r{i}  {p.score:7.4f}  d={d!s:<2} s={s!s:<2} {corto(p.payload)}")

    textos = [p.payload["texto"] for p in fusion]
    scores = list(reranker.rerank(query=pregunta, documents=textos))
    print("\n== 4. Reranker (logit sin acotar; > 0 suele ser relevante) ==")
    for score, i in sorted(zip(scores, range(len(fusion))), reverse=True):
        print(f"  {score:7.3f}  venia de r{i}  {corto(fusion[i].payload)}")


if __name__ == "__main__":
    main()
EOF
```

Vas a lanzar tres preguntas, cada una pensada para un caso distinto:

| # | Pregunta | Qué pone a prueba |
|---|---|---|
| P1 | `¿Qué hago si la aplicación no responde?` | Paráfrasis: el fragmento bueno dice *"deja de contestar"*. Y hay una trampa léxica: *"responde"* aparece en el reinicio de la API. |
| P2 | `E-4471` | Literal puro: un código. |
| P3 | `¿En qué puerto escucha Qdrant?` | Mixto: semántica y un nombre propio. |

**Antes de lanzar nada**, escribe en la entrega tu predicción para cada pregunta: qué fragmento saldrá 1.º en la densa, cuál 1.º en BM25 y cuál 1.º tras el reranker. Razónalo con la sección 1.1.

```bash
uv run python /tmp/agent4u-dia07/etapas.py "¿Qué hago si la aplicación no responde?"
uv run python /tmp/agent4u-dia07/etapas.py "E-4471"
uv run python /tmp/agent4u-dia07/etapas.py "¿En qué puerto escucha Qdrant?"
```

Cada ejecución carga los tres modelos (unos segundos). Pega las tres salidas y compáralas con tu predicción. Fíjate sobre todo en:

- ¿Cuántos fragmentos devuelve BM25 para P2? ¿Por qué no devuelve los 6? (Pista: un fragmento sin ningún término en común con la pregunta tiene puntuación 0 y Qdrant no lo devuelve.)
- Los cosenos de la densa en P2: ¿hay mucha diferencia entre el 1.º y el 6.º?
- ¿En qué pregunta el reranker cambia más el orden de RRF?
- ¿Algún fragmento claramente irrelevante (vacaciones) tiene logit positivo?

### Paso 5 — RRF a mano, la `k` y los pesos (30 min)

**5.1 Descubre la `k`.** Coge la sección 3 de la salida de P1. Para los dos primeros fragmentos tienes su posición en cada lista (`d=` y `s=`) y su puntuación RRF. Calcula a mano `1/(k + d) + 1/(k + s)` con `k = 2` y con `k = 60`, y di cuál coincide con lo que da Qdrant. Puedes usar esto:

```bash
python3 -c "
d, s = 0, 1     # cambia por las posiciones de tu salida; usa None si no aparece
for k in (2, 60):
    print(k, sum(1 / (k + p) for p in (d, s) if p is not None))"
```

**5.2 Cambia la `k`.** Repite P1 y P3 con `k = 60`:

```bash
uv run python /tmp/agent4u-dia07/etapas.py "¿Qué hago si la aplicación no responde?" 60
uv run python /tmp/agent4u-dia07/etapas.py "¿En qué puerto escucha Qdrant?" 60
```

¿Cambia el orden de la sección 3? ¿Y el de la sección 4? Explica por qué el orden final del reranker **no** depende de la `k` mientras el número de candidatos sea mayor o igual que el de fragmentos (aquí, 8 frente a 6). ¿Cuándo sí dependería?

**5.3 Pesos.** Da tres veces más peso a la densa que a BM25, y después al revés:

```bash
uv run python /tmp/agent4u-dia07/etapas.py "E-4471" 2 3 1
uv run python /tmp/agent4u-dia07/etapas.py "E-4471" 2 1 3
```

Anota qué fragmento queda 1.º en RRF en cada caso.

### Paso 6 — `max_fragmentos` en `search_chunks` (10 min)

`search_chunks` sí respeta `max_fragmentos`. Compruébalo llamándola directamente:

```bash
uv run python - <<'EOF'
from fastembed import SparseTextEmbedding, TextEmbedding
from fastembed.rerank.cross_encoder import TextCrossEncoder
from qdrant_client import QdrantClient

from app.core.config import get_settings
from app.rag.retrieval import search_chunks

dense = TextEmbedding("intfloat/multilingual-e5-large")
sparse = SparseTextEmbedding("Qdrant/bm25", language="spanish")
reranker = TextCrossEncoder("jinaai/jina-reranker-v2-base-multilingual")
qdrant = QdrantClient(url=get_settings().qdrant_url)

for n in (1, 3, 10, 20):
    r = search_chunks("¿En qué puerto escucha Qdrant?", dense, sparse, qdrant, reranker, max_fragmentos=n)
    print(f"max_fragmentos={n:>2} -> {len(r)} fragmentos, scores {[round(c['score'], 2) for c in r]}")
EOF
```

Pega la salida. ¿Por qué con 10 y con 20 salen los mismos?

### Paso 7 — TDD: que `max_fragmentos` atraviese el grafo (45 min)

**7.1 Los tests en rojo.** Dos ficheros. El primero prueba `search_chunks` con dobles: sin modelos, sin Qdrant.

```bash
cd ~/ruta/AGENT4U/backend
cat > tests/unit/test_recuperacion.py <<'EOF'
"""Unitarios de app/rag/retrieval.py con dobles: sin modelos ni Qdrant reales."""
from types import SimpleNamespace

import numpy as np
from qdrant_client import models

from app.rag.retrieval import search_chunks


class DenseFalso:
    def __init__(self):
        self.textos = []

    def embed(self, textos):
        self.textos.extend(textos)
        return iter([np.ones(4, dtype=np.float32)])


class SparseFalso:
    def __init__(self):
        self.llamadas = []

    def _vector(self):
        return SimpleNamespace(indices=np.array([7, 9]), values=np.array([1.0, 1.0]))

    def embed(self, textos):
        self.llamadas.append("embed")
        return iter([self._vector()])

    def query_embed(self, texto):
        self.llamadas.append("query_embed")
        return iter([self._vector()])


class QdrantFalso:
    """Devuelve `n` puntos y guarda los argumentos de query_points."""

    def __init__(self, n=6):
        self.n = n
        self.kwargs = None

    def query_points(self, **kwargs):
        self.kwargs = kwargs
        puntos = [
            SimpleNamespace(payload={"texto": f"frag{i}", "nombre": "doc.md", "paginas": [], "headings": []})
            for i in range(self.n)
        ]
        return SimpleNamespace(points=puntos)


class RerankerFalso:
    """Puntua al reves del orden de llegada: el ultimo de RRF es el mejor."""

    def rerank(self, query, documents):
        return [float(i) for i, _ in enumerate(documents)]


def buscar(max_fragmentos=10, n=6):
    dense, sparse, qdrant = DenseFalso(), SparseFalso(), QdrantFalso(n)
    resultado = search_chunks("¿Cómo reinicio la API?", dense, sparse, qdrant, RerankerFalso(), max_fragmentos=max_fragmentos)
    return resultado, dense, sparse, qdrant


def test_lanza_una_busqueda_densa_y_otra_dispersa_y_las_funde_con_rrf():
    _, _, _, qdrant = buscar()

    usados = sorted(p.using for p in qdrant.kwargs["prefetch"])
    assert usados == ["dense_vector", "sparse_vector"]
    assert isinstance(qdrant.kwargs["query"], models.RrfQuery)


def test_la_pregunta_densa_lleva_el_prefijo_query_de_e5():
    _, dense, _, _ = buscar()

    assert dense.textos == ["query: ¿Cómo reinicio la API?"]


def test_la_pregunta_dispersa_usa_query_embed():
    _, _, sparse, _ = buscar()

    assert sparse.llamadas == ["query_embed"]


def test_max_fragmentos_recorta_despues_de_reordenar():
    resultado, *_ = buscar(max_fragmentos=3, n=6)

    assert [r["chunk"] for r in resultado] == ["frag5", "frag4", "frag3"]
EOF
```

El segundo compila **el grafo real** y sustituye solo el LLM y la búsqueda con `monkeypatch`. Es el test que faltaba: prueba el camino entero, `Send` incluido.

```bash
cat > tests/integration/test_grafo_max_fragmentos.py <<'EOF'
"""El grafo real, con el LLM y la busqueda sustituidos por dobles.

Comprueba que el max_fragmentos que llega por POST /preguntar atraviesa el
`Send` de LangGraph hasta search_chunks y acota lo que llega al prompt.
"""
import pytest

from app.rag.grafo import grafo_nodes
from app.rag.grafo.grafo_create import crear_grafo


@pytest.fixture
def busquedas(monkeypatch):
    """Sustituye LLM y busqueda; devuelve la lista de max_fragmentos recibidos."""
    recibidos = []

    def search_chunks_falso(consulta, *_args, max_fragmentos=10):
        recibidos.append(max_fragmentos)
        return [{"chunk": f"{consulta}-{i}", "score": 5.0 - i / 100} for i in range(max_fragmentos)]

    monkeypatch.setattr(grafo_nodes, "reformular_consulta", lambda query, historial, model: query)
    monkeypatch.setattr(grafo_nodes, "descomponer_consulta", lambda consulta, model: [f"{consulta} A", f"{consulta} B"])
    monkeypatch.setattr(grafo_nodes, "generate_query", lambda query, chunks, historial: [])
    monkeypatch.setattr(grafo_nodes, "search_chunks", search_chunks_falso)
    return recibidos


def ejecutar(max_fragmentos):
    grafo = crear_grafo(None, None, None, None, model="falso")
    return grafo.invoke({"query": "reinicio", "historial": [], "max_fragmentos": max_fragmentos})


@pytest.mark.parametrize("pedidos", [1, 3, 15])
def test_cada_rama_busca_con_el_max_fragmentos_pedido(busquedas, pedidos):
    ejecutar(pedidos)

    assert busquedas == [pedidos, pedidos]


@pytest.mark.parametrize("pedidos", [1, 3, 15])
def test_al_prompt_llegan_como_mucho_max_fragmentos(busquedas, pedidos):
    estado = ejecutar(pedidos)

    assert 0 < len(estado["chunks"]) <= pedidos


def test_pedir_mas_de_nueve_deja_pasar_mas_de_nueve(busquedas):
    estado = ejecutar(15)

    assert len(estado["chunks"]) > 9
EOF

uv run pytest -q tests/unit/test_recuperacion.py tests/integration/test_grafo_max_fragmentos.py
# esperado: 7 failed, 4 passed
```

Lee los mensajes de los fallos antes de seguir: `assert [10, 10] == [3, 3]` es el `Send` que pierde el valor, y el `len(...) > 9` es el presupuesto fijo de `fusionar`. ¿Por qué `test_al_prompt_llegan_como_mucho_max_fragmentos[15]` ya pasa en rojo? Contéstalo en la entrega.

Fíjate en una cosa del segundo fichero: `monkeypatch.setattr(grafo_nodes, "search_chunks", ...)` funciona porque `grafo_nodes.py` hace `from app.rag.retrieval import search_chunks`, y por tanto busca el nombre en **su propio** módulo. Parchear `app.rag.retrieval.search_chunks` no habría servido. Es la regla de oro de los mocks en Python: se parchea donde se **usa**, no donde se define.

**7.2 El arreglo.** Son tres ficheros:

- En `grafo_nodes.py`: una constante para el valor por defecto, `repartir` que mete `max_fragmentos` en la carga del `Send`, y `fusionar` que usa `max_fragmentos` como presupuesto y recorta al final (con más ramas que presupuesto, la cuota mínima de 1 por rama se pasaría).
- En `retrieval.py`: `query_embed` para BM25.
- En `query_service.py`: mandar siempre `max_fragmentos`, usando `APP_MAX_FRAGMENTOS_DEFECTO` si el cliente no lo pide.

Este script hace los cambios y falla si no encuentra el código que espera. Si prefieres hacerlos a mano, son exactamente los textos que ves en él.

```bash
cat > /tmp/agent4u-dia07/arreglo.py <<'EOF'
import re
from pathlib import Path


def cambiar(ruta, viejo, nuevo, regex=False):
    p = Path(ruta)
    s = p.read_text(encoding="utf-8")
    n = len(re.findall(viejo, s, flags=re.S)) if regex else s.count(viejo)
    assert n == 1, f"{ruta}: esperaba 1 coincidencia y hay {n}: {viejo[:50]!r}"
    s = re.sub(viejo, lambda _: nuevo, s, flags=re.S) if regex else s.replace(viejo, nuevo)
    p.write_text(s, encoding="utf-8")


G = "app/rag/grafo/grafo_nodes.py"
cambiar(G, "from app.rag.prompt import generate_query\n",
        "from app.rag.prompt import generate_query\n\n"
        "# Fragmentos que llegan al prompt si nadie pide otro numero. POST /preguntar\n"
        "# siempre lo manda (APP_MAX_FRAGMENTOS_DEFECTO); esto solo cubre a quien\n"
        "# invoque el grafo directamente, como los tests.\n"
        "MAX_FRAGMENTOS_DEFECTO = 9\n")
cambiar(G, r"    def repartir\(estado: ?EstadoRAG\):\n.*?for subconsulta in estado\[\"subconsultas\"\]\]\n",
        "    def repartir(estado: EstadoRAG):\n"
        "        # Send entrega a \"buscar\" SOLO este dict, no el estado global: todo lo\n"
        "        # que la rama necesite tiene que viajar aqui.\n"
        "        max_fragmentos = estado.get(\"max_fragmentos\", MAX_FRAGMENTOS_DEFECTO)\n"
        "        return [\n"
        "            Send(\"buscar\", {\"consulta_busqueda\": subconsulta, \"max_fragmentos\": max_fragmentos})\n"
        "            for subconsulta in estado[\"subconsultas\"]\n"
        "        ]\n", regex=True)
cambiar(G, 'max_fragmentos=estado.get("max_fragmentos", 10),',
        'max_fragmentos=estado.get("max_fragmentos", MAX_FRAGMENTOS_DEFECTO),')
cambiar(G, "        presupuesto = 9\n",
        '        presupuesto = estado.get("max_fragmentos", MAX_FRAGMENTOS_DEFECTO)\n')
cambiar(G, '        return {"chunks": finales}\n',
        "        # Con mas ramas que presupuesto, la cuota minima de 1 por rama se pasa.\n"
        '        return {"chunks": finales[:presupuesto]}\n')

cambiar("app/rag/retrieval.py",
        "query_vector_sparse = next(iter(sparse_embedder.embed([query])))",
        "# query_embed y no embed: la pregunta no es un documento. Para BM25 da\n"
        "    # peso 1 a cada termino, sin la normalizacion por longitud de documento.\n"
        "    query_vector_sparse = next(iter(sparse_embedder.query_embed(query)))")

Q = "app/services/query_service.py"
cambiar(Q, "from app.db.crud import conversation as conversation_crud\n",
        "from app.core.config import get_settings\nfrom app.db.crud import conversation as conversation_crud\n")
cambiar(Q, r"    entrada = \{\"query\": query, \"historial\": historial\}\n.*?entrada\[\"max_fragmentos\"\] = max_fragmentos\n",
        "    # Siempre se manda: si el cliente no lo pide, manda la configuracion.\n"
        "    # Antes solo viajaba si se pedia y APP_MAX_FRAGMENTOS_DEFECTO no se usaba.\n"
        "    if max_fragmentos is None:\n"
        "        max_fragmentos = get_settings().max_fragmentos_defecto\n"
        "    entrada = {\"query\": query, \"historial\": historial, \"max_fragmentos\": max_fragmentos}\n",
        regex=True)
print("arreglo aplicado")
EOF

uv run python /tmp/agent4u-dia07/arreglo.py
git diff --stat           # 3 ficheros de app/
uv run pytest -q tests/unit/test_recuperacion.py tests/integration/test_grafo_max_fragmentos.py
# esperado: 11 passed
```

**Lee el diff entero** (`git diff app/`) antes de seguir. Tienes que poder explicar cada línea en la entrega.

Una decisión que he tomado por ti y que puedes discutir: la constante del grafo vale 9 y no 10, para no cambiar el comportamiento que ya fijaba `test_grafo_nodes.py` (`test_una_rama_se_queda_con_el_presupuesto_completo` espera 9). En producción da igual, porque ahora `query_service` siempre manda el valor de la configuración (10). Pero quedan dos números por defecto, 9 en el grafo y 10 en `Settings`. ¿Lo dejarías así o lo unificarías? Razónalo en la entrega.

**7.3 El README.** Corrige el nombre de la función y añade lo que faltaba: BM25, RRF con su `k` y el reranker.

```bash
cd ~/ruta/AGENT4U
cat > /tmp/agent4u-dia07/readme.py <<'EOF'
from pathlib import Path

p = Path("README.md")
s = p.read_text(encoding="utf-8")
viejo = "`buscar_chunks()` embebe la pregunta con el prefijo `query:`"
nuevo = "`search_chunks()` embebe la pregunta con el prefijo `query:`"
assert s.count(viejo) == 1, "No encuentro la frase de buscar_chunks"
s = s.replace(viejo, nuevo)
ancla = "(sustituye al `search()` clásico, ya en desuso)."
assert s.count(ancla) == 1, "No encuentro el final de la frase"
s = s.replace(ancla, ancla + (
    " La pregunta se vectoriza dos veces (densa con `query:`, BM25 con `query_embed`);"
    " Qdrant lanza las dos búsquedas, 20 candidatos cada una, y las funde con RRF"
    " (k = 2, el valor por defecto de Qdrant). El cross-encoder"
    " `jina-reranker-v2-base-multilingual` reordena esos 20 y se quedan `max_fragmentos`."))
p.write_text(s, encoding="utf-8")
print("README actualizado")
EOF
python3 /tmp/agent4u-dia07/readme.py
git diff --stat README.md        # 1 insertion(+), 1 deletion(-)
```

### Paso 8 (opcional, solo si tienes `APP_GEMINI_API_KEY`) — compruébalo de punta a punta (15 min)

Si tienes clave de Gemini en `backend/.env`, reinicia la API (`Ctrl+C` en la terminal A y vuelve a lanzarla, que tiene el código viejo cargado) y lanza la misma pregunta con 2 y con 15 fragmentos. Los eventos `paso` del SSE dicen cuántos fragmentos devolvió cada rama de `buscar` y cuántos salieron de `fusionar`:

```bash
for n in 2 15; do
  echo "--- max_fragmentos=$n"
  curl -sN -X POST localhost:8000/preguntar -H 'Content-Type: application/json' \
    -d "{\"query\": \"¿En qué puerto escucha Qdrant y cómo reinicio la API?\", \"max_fragmentos\": $n}" \
    | grep '"tipo": "paso"' | grep -E '"nodo": "(buscar|fusionar)"'
done
```

Con el corpus de 6 fragmentos, con 15 verás como mucho 6 por rama. Si no tienes clave, sáltate este paso y dilo en la entrega: los tests del Paso 7 ya prueban lo mismo con el grafo real.

Cuando acabes, apaga todo:

```bash
# Ctrl+C en las terminales A y B
docker compose stop qdrant redis
```

### Paso 9 — Validar y subir (5 min)

```bash
cd ~/ruta/AGENT4U/backend
uv run pytest -q                  # 102 passed (91 + 11 nuevos)
uv run ruff check app tests       # All checks passed!
cd ..
git add backend/app/rag/grafo/grafo_nodes.py backend/app/rag/retrieval.py \
        backend/app/services/query_service.py \
        backend/tests/unit/test_recuperacion.py backend/tests/integration/test_grafo_max_fragmentos.py \
        README.md
git diff --cached --stat          # 6 ficheros, ni uno más
git commit -m "fix(recuperacion): max_fragmentos atraviesa el Send del grafo; BM25 con query_embed"
git push -u origin ejercicio/dia-07
```

### Preguntas (responde con tus palabras en la entrega)

1. Explica con tus palabras por qué existe la búsqueda híbrida. Usa tus salidas de P1 y P2 como ejemplo: dónde acierta cada búsqueda y dónde falla.
2. ¿Qué `k` usa Qdrant por defecto? Demuéstralo con tu cálculo del Paso 5.1. ¿Qué cambia en el comportamiento de la fusión con `k = 60`? ¿Pondrías la `k` en `Settings`?
3. ¿Por qué el reranker no se usa directamente sobre toda la colección, sin búsqueda previa? Calcula a grandes rasgos qué pasaría con 100.000 fragmentos.
4. El logit del reranker puede ser negativo. ¿Qué significa? ¿Por qué no se puede comparar el score de dos preguntas distintas? ¿Qué nodo del grafo toma decisiones con ese número, y con qué umbral?
5. Cuenta, paso a paso y con ficheros y líneas, por qué antes del arreglo el control deslizante de *Ajustes* no tenía ningún efecto. ¿Qué hace exactamente `Send` con el estado?
6. `embed` frente a `query_embed` en BM25: ¿qué peso recibe cada término de la pregunta en cada caso? ¿Por qué el orden de BM25 casi nunca cambiaba? ¿Por qué merece la pena arreglarlo igualmente?
7. Hoy, pedir `max_fragmentos = 20` equivale a no filtrar nada. ¿Por qué? Si quisieras permitir hasta 30, ¿qué otros números del código tendrías que cambiar?
8. La licencia del reranker es CC-BY-NC-4.0. ¿Qué implica para AGENT4U? ¿Qué harías si mañana tuvieras un cliente?

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-07` en el remoto, creada desde `main` (`git merge-base --is-ancestor origin/main origin/ejercicio/dia-07`).
- [ ] Paso 3: los tres documentos en `indexado` con 2 fragmentos y 6 puntos en `dia07`.
- [ ] Paso 4: predicción escrita **antes** de las salidas, y las tres salidas de `etapas.py` pegadas.
- [ ] Paso 5: el cálculo a mano que identifica la `k`, las salidas con `k = 60` y las dos con pesos.
- [ ] Paso 6: la salida con 1, 3, 10 y 20 fragmentos.
- [ ] Paso 7.1: resumen de pytest con `7 failed, 4 passed` **antes** del arreglo.
- [ ] Paso 7.2: `11 passed` tras el arreglo; `repartir` mete `max_fragmentos` en el `Send` y `fusionar` ya no tiene `presupuesto = 9`.
- [ ] `uv run pytest -q` → `102 passed` y `uv run ruff check app tests` limpio (pega los resúmenes).
- [ ] `git diff --stat origin/main origin/ejercicio/dia-07` muestra solo los 6 ficheros del Paso 9.
- [ ] Paso 8 hecho o, si no tienes clave, dicho explícitamente.
- [ ] Las 8 preguntas respondidas con tus palabras, más las dos del Paso 7 (por qué `[15]` ya pasaba en rojo, y 9 frente a 10).
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

Entrega (antes de las 8:30 del **martes 3-nov**):

```bash
git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-07.md
# ...rellena dia-07.md: predicciones, salidas de los pasos 3-8, resúmenes de pytest y ruff, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-07.md
git commit -m "entrega día 07" && git push
```

Si quieres feedback antes de entregar, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code con `XX = 07`, estando en tu rama `ejercicio/dia-07`.

---

## 5. Para profundizar (opcional)

- Qdrant, *Hybrid and Multi-Stage Queries* (`prefetch`, RRF con su fórmula, `k` y pesos): https://qdrant.tech/documentation/concepts/hybrid-search/
- Cormack, Clarke y Büttcher (2009), el artículo original de RRF: dos páginas, y de ahí sale el famoso `k = 60`: https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la sección *5. Recuperación y reranking* debería cubrir:

- El embudo: dos búsquedas de 20 (densa con `query:`, BM25 con `query_embed`) → RRF en Qdrant, en una sola llamada → cross-encoder sobre 20 → `max_fragmentos`.
- Por qué híbrida: qué tipo de pregunta resuelve cada mitad, con un ejemplo de tu corpus.
- RRF: qué combina (posiciones, no puntuaciones), la `k = 2` implícita de Qdrant y lo que cambiaría con 60.
- Qué es el `score` que llega al grafo y al frontend (un logit sin acotar, comparable solo dentro de una pregunta).
- Cómo viaja `max_fragmentos` desde la UI hasta el prompt después de tu arreglo, y la lección del `Send`.
- Los huecos abiertos: la licencia no comercial del reranker, el embudo escrito a mano en tres sitios, la falta de umbral de relevancia y el filtro por estado del documento.

**El martes 3-nov (día 08):** el grafo agéntico de LangGraph entero. Hoy has visto un nodo (`buscar`) y una arista (`repartir`); el martes, los siete nodos, el estado con su reductor `acumular`, las aristas condicionales y el bucle de reescritura (`evaluar → reescribir → multiconsulta`), con sus umbrales de logit (`<= 0` y `< -1`). Dibujarás el grafo y registrarás el paso por cada nodo.
