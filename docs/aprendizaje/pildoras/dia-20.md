# Píldora 20 — El arnés de evaluación del RAG

**Viernes 27-nov-2026 · sesión corta: 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 19

No hay entrega del día 19: en `origin/aprendizaje` no existe `entregas/dia-19.md` ni hay ramas `ejercicio/dia-*` en el remoto. Tampoco ha llegado tarde ninguna anterior. Sin nota.

`main` sigue en `2cf91a8` («Feat/deduplicacion #45», 16-nov), así que lo del día 19 sigue pendiente: el CI solo ejecuta los tests del backend y el gateway sigue sin ruff fijado. Si retomas un ejercicio atrasado, que sea ese. Es el único que deja algo útil en `main`.

---

## 1. Concepto clave: los tests dicen si el código hace lo que escribiste; la evaluación dice si el RAG responde bien

### 1.1 Por qué los 188 tests no bastan

Los tests de los días 17 y 18 trabajan con **dobles**: un LLM falso, un Qdrant en memoria y embeddings de juguete. Así se comprueba que el grafo pasa por los nodos correctos, que el SSE sale en orden y que un fallo se convierte en un evento `error`. Lo que **no** pueden comprobar es si, con los modelos reales, la pregunta «¿En qué RFC se define PKCE?» recupera el fragmento de `04-oauth2-autenticacion.md` y el modelo contesta «RFC 7636».

Eso no depende de tu código. Depende de los **datos y de los modelos**: el tamaño del chunk, el embedder, el reranker, el `max_fragmentos`, el prompt y la versión de Gemini que haya ese día. Puedes cambiar `chunk_max_tokens` de 500 a 300 con los 188 tests en verde y que, aun así, empeore un tercio de las respuestas. La evaluación existe para ese tipo de regresión.

| | Test | Evaluación |
|---|---|---|
| Qué mide | Lógica: dado X, el código hace Y | Calidad: ante preguntas reales, ¿la respuesta es buena? |
| Dependencias | Dobles, deterministas | Qdrant, embedder, reranker y LLM reales |
| Resultado | Pasa o falla | Un número (0,84) que se compara con el de la última vez |
| Coste | Milisegundos, gratis | Segundos por pregunta, consume cupo del LLM |
| Dónde corre | En cada push (CI) | A mano, o cada noche, o antes de mezclar un cambio de RAG |

### 1.2 Las dos mitades de un RAG se miden por separado

Un RAG falla de dos maneras distintas, y conviene saber cuál de las dos ha fallado:

1. **Recuperación**: el fragmento bueno no llega al contexto. El modelo no puede acertar aunque sea perfecto.
2. **Generación**: el fragmento llega, pero el modelo lo ignora, lo malinterpreta o inventa algo.

Para la recuperación, las métricas clásicas son sencillas y no necesitan ningún LLM:

- **hit@k**: proporción de preguntas en las que el documento esperado aparece entre los *k* fragmentos que llegan al modelo.
- **MRR** (*mean reciprocal rank*): la media de `1/posición` del primer acierto. Si el documento bueno sale primero suma 1; si sale tercero, 0,33; si no sale, 0. Premia que salga **arriba**, y no solo que salga.

Para la generación hay tres familias, de más barata a más cara:

- **Coincidencia literal**: ¿la respuesta contiene «RFC 7636»? Es barata y determinista. Funciona con datos exactos y falla con paráfrasis.
- **Similitud de embeddings** entre la respuesta y la esperada. Parece más lista, pero tiene trampa (sección 3).
- **LLM como juez** (es lo que hace RAGAS): otro modelo puntúa la fidelidad al contexto y la relevancia. Es la más rica, pero también la más cara, la menos determinista y depende de un segundo modelo.

### 1.3 La pregunta sin respuesta vale tanto como la que tiene respuesta

Un RAG que siempre responde algo parece muy útil hasta que inventa. Por eso un set serio incluye preguntas **sin respuesta en el corpus** y comprueba que el sistema dice «no lo sé». En AGENT4U esa frase está fijada en el prompt, así que se puede comprobar con una búsqueda literal. Es una gran ventaja, y la usaremos.

---

## 2. Cómo está en AGENT4U

### 2.1 Lo que hay en `backend/tests/evaluation/` (5 ficheros)

```text
$ git ls-tree -r -l origin/main backend/tests/evaluation
 2334  conversaciones_dificiles.json
 3567  index_all_docs.py
 2348  index_hard_docs.py
 7949  response_file.json
 8407  response_file_dificil.json
```

Hay **tres sets de preguntas y dos scripts de indexación. No hay nada que puntúe.**

**`response_file.json`: 25 preguntas, 5 tipos.** Cada entrada tiene esta forma:

```json
{
  "id": 7,
  "pregunta": "¿En qué RFC se define PKCE?",
  "tipo": "exacta",
  "documento_esperado": "04-oauth2-autenticacion.md",
  "debe_contener": "RFC 7636",
  "respuesta_esperada": "En el RFC 7636, publicado en septiembre de 2015."
}
```

El reparto, contado hoy: `exacta` 7, `semantica` 6, `tabla` 6, `discriminacion` 3 y `ausente` 3. Las 22 que tienen respuesta apuntan a **10 documentos distintos** (del `01` al `10`). El README dice «11 documentos».

Fíjate en qué es `debe_contener`. **No es un trozo de la respuesta esperada, sino del documento fuente.** En la pregunta 1 es «depende transitivamente», mientras que la respuesta esperada dice «dependencias transitivas». En la 21 es «Obsoleto, no debe usarse», que es una celda de una tabla y no algo que vaya a escribir el modelo. Lo he comprobado: las 22 claves aparecen en su documento (sin distinguir mayúsculas ni tildes). Así que `debe_contener` sirve para comprobar el **contexto** (si el fragmento correcto llegó), no la respuesta.

**`response_file_dificil.json`: 18 preguntas, ids 101-118**, en tres tipos de 6:

- `vocabulario_indirecto`: describen el concepto sin nombrarlo («¿qué mecanismo evita que muchos procesos recalculen a la vez…?» → *estampida*). Ponen a prueba el retrieval denso frente a BM25.
- `solape_tematico`: dos documentos parecidos y hay que elegir el bueno.
- `trampa`: el documento existe y habla del tema, **pero no contiene el dato** («¿qué versión de MongoDB introdujo…?»). Son más difíciles que `ausente`, porque el contexto parece relevante y el modelo tiene la tentación de completar con lo que sabe.

**`conversaciones_dificiles.json`: 5 conversaciones de dos turnos.** El segundo turno solo se entiende con el primero («¿Quién lo demostró formalmente?»). Sirven para probar el nodo `reformular`. Hoy **nadie las lee**: los scripts que las consumían se borraron (sección 3).

**`index_all_docs.py` e `index_hard_docs.py`** indexan sin pasar por la cola. Llaman directamente a las mismas funciones que el worker:

```python
# index_all_docs.py, líneas 71-89 (resumido)
doc_id = registrar_documento(db, str(ruta), ruta.name,
                             ruta.suffix.lstrip(".").lower(), ruta.stat().st_size)
...
num_chunks = indexar_documento(doc_id, file_path=str(ruta), converter=converter,
                               chunker=chunker, dense_embedder=dense_embedder,
                               sparse_embedder=sparse_embedder, qdrant=qdrant)
```

`registrar_documento` existe en `app/services/indexacion.py:24` solo para ellos, y lo dice su docstring: «Es lo que hacen los scripts de evaluacion; la API crea la suya con `crear_documento_encolado`». `index_all_docs.py` está bien escrito: se puede relanzar, se salta lo ya indexado (`DocumentoYaExiste`), sigue si un fichero falla y sale con código 1 si hubo fallos.

**Que pytest no los recoja es una decisión explícita** (`backend/pyproject.toml`):

```toml
# Solo se recolecta test_*.py: deja fuera los scripts manuales de
# tests/evaluation/, que llaman al LLM y a Qdrant reales.
python_files = ["test_*.py"]
```

### 2.2 El corpus: no está en el repo

Los dos scripts leen de `backend/tests/data/`. Ese directorio **no existe en `main`**, porque el `.gitignore` raíz lo excluye (`/backend/tests/data/`). Los 17 documentos (`01` a `17`) se borraron del repo en `fb93eea` (#38, 21-oct), pero siguen en el historial:

```bash
git restore --source=fb93eea^ -- backend/tests/data/   # 17 ficheros .md
git status --short                                      # vacío: están ignorados
```

Los documentos `18-replicacion-particionado.md` y `19-resiliencia-microservicios.md`, que `index_hard_docs.py` tiene escritos a fuego, **no han estado nunca en git**: `git log --all -- 'backend/tests/data/18*'` no devuelve nada. Si no los tienes en tu disco, las preguntas 107-110 y dos de las cinco conversaciones son irrecuperables.

### 2.3 Lo que da la API para evaluar sin tocar código

Para puntuar no hace falta importar nada de `app`. El stream de `POST /preguntar` ya trae todo lo necesario:

| Evento SSE | Qué aporta a la evaluación | De dónde sale |
|---|---|---|
| `inicio` | `conversacion_id`, para borrarla después | `query_service.responder` |
| `paso` con `nodo: "evaluar"` | `score` (el mejor del cross-encoder) y `pobre` | `datos_del_paso` en `query_service.py` |
| `paso` con `nodo: "reescribir"` | cuántas veces se reescribió la consulta | ídem |
| `fuentes` | `nombre`, `texto` y `score` de cada fragmento, **ordenados por score** | `fuente_desde_chunk` en `rag/streaming.py`; el orden lo fija `nodo_fusionar` |
| `texto` × N | la respuesta, que hay que concatenar | `responder_stream` |
| `error` | el fallo del LLM o del grafo | ídem |

Con `fuentes` se calculan hit@k y MRR. Con `texto` se busca la frase de rechazo que exige `SYSTEM_PROMPT_STREAMING` (`rag/prompt.py`):

```text
- Si, y solo si, el contexto no contiene la respuesta, dilo explícitamente: "No encuentro esa información en los documentos."
```

Y `paso/evaluar` te deja ver el umbral que decide si se reescribe la consulta (`grafo_nodes.py`, `nodo_evaluar` y `decidir_reconsulta`):

```python
"contexto_pobre": mejor_score <= 0,          # nodo_evaluar
...
if not estado.get("contexto_pobre"): return "construir"
if estado.get("valor_maximo", 0) < -1: return "construir"   # nada que rescatar
if estado.get("intentos", 0) >= 2:     return "construir"
return "reescribir"
```

Los umbrales `0` y `-1` sobre la puntuación del reranker de Jina están escritos a mano. Ningún dato del repo los justifica. Con el script de hoy los vas a poder ver contra preguntas reales.

---

## 3. Por qué se montó así (y qué no cuadra)

### 3.1 La historia del arnés, según el `git log`

- **15-ago**: llega el arnés con las 25 preguntas (README, *Roadmap*).
- Crecen cinco scripts en `backend/tests/`: `response_test.py`, `retrieval_scores_test.py`, `grafo_test.py`, `conversacional_test.py` y `grafo_conversacional_test.py`.
- **5-sep** (`62b7546`, #24): se añade `python_files = ["test_*.py"]`. El comentario original explica el motivo: los `*_test.py` «son scripts manuales […]; sin este filtro, pytest los recolecta igualmente por el patron `*_test.py` y rompe la recoleccion si alguno tiene un import obsoleto».
- **6-sep** (`aa222ec`, #27, el mismo PR que trae el CI): se borran los cinco scripts y los JSON pasan a `tests/evaluation/`.

Lo interesante es **en qué estado estaban cuando se borraron**. `git show aa222ec^:backend/tests/response_test.py` importa `generate_response` de `app.rag.prompt`, que en ese commit ya no existía, y `from backend.app.rag.retrieval import search_chunks`, una ruta que no funciona con el `sys.path` que el propio script prepara. Además llamaba a `search_chunks(query=…, embedder=…, qdrant=…)`, una firma anterior al retrieval híbrido. **El arnés llevaba tiempo muerto: no se borró una herramienta viva, se enterró un cadáver.**

La lección es de diseño: **el arnés murió porque estaba acoplado a funciones internas y nadie lo ejecutaba.** Cada refactor de `retrieval.py` o `prompt.py` lo rompía en silencio. El de hoy habla con `POST /preguntar`, que es un **contrato público**. Ese contrato está documentado en el `description` del endpoint y lo vigilan los tests de la API y del frontend (días 13 y 18). Así sobrevive a cualquier refactor interno y mide exactamente lo que ve el usuario, grafo incluido. El coste es que necesita la API levantada y no puede aislar una pieza: para probar solo el reranker tendrías que volver a llamar a funciones internas.

### 3.2 Por qué fuera de pytest

Es correcto. Una evaluación con un LLM real **no es determinista**: la misma pregunta puede pasar cuatro veces y fallar la quinta. Además gasta cupo (Gemini gratuito tiene un límite de peticiones por minuto) y tarda segundos por pregunta. Metida en la suite haría el CI lento, caro e inestable, que es justo lo que el día 19 dice que hay que evitar. Lo que sí se puede llevar al CI es una **puerta con umbral** (`--minimo 0.8`) ejecutada a mano o cada noche, nunca en cada push.

### 3.3 El «100 %» del README

El README cita como referencia histórica «25 preguntas × 5 rondas = 125 consultas, 100 % de precisión y 100 % de retrieval», con un umbral de similitud coseno de 0,85. Hace bien en no venderlo como medida actual, pero hay que decir más:

- **El sistema medido ya no existe.** Desde agosto han cambiado el retrieval (híbrido + RRF + cross-encoder), el chunker (500 tokens), el grafo (multiconsulta y reescritura), el prompt y el modelo por defecto. Ese número no se puede comparar con nada de hoy.
- **El criterio era blando.** `response_test.py` daba por buena una respuesta si su embedding `multilingual-e5-large` tenía un coseno ≥ 0,85 con el de la respuesta esperada. Los modelos E5 se entrenan con una temperatura muy baja y sus similitudes se concentran entre 0,7 y 1,0, incluso entre textos poco relacionados (lo explica la ficha del modelo, en su FAQ). Con 0,85, dos respuestas del mismo tema en español pueden aprobar aunque den un dato distinto: «9 bares» frente a «15 bares».
- **El corpus es diminuto**: 17 documentos de entre 14 y 40 líneas, 456 líneas en total. El retrieval trae 20 candidatos y pasa 10 al modelo (`max_fragmentos_defecto = 10`). **Con un corpus tan pequeño, hit@10 es casi trivial.** Para que el retrieval se note hay que bajar *k*, y por eso el ejercicio repite la medida con `--max-fragmentos 3`.

### Cosas que no cuadran, comprobadas hoy

- 🔴 **No hay arnés, y el README promete uno a medias.** La tabla del README dice «Evaluación RAG: Parcial» y el roadmap, «Pendiente». Es honesto, pero lo práctico es que **hoy cualquier cambio en el RAG se mezcla sin medir.** El 16-nov entró la deduplicación de nivel 3, que puede dejar documentos en `pendiente-decision`, y nadie comprobó si alteraba el retrieval del set.
- 🟠 **El corpus no está versionado.** Un set de evaluación sin su corpus no sirve: las preguntas apuntan a ficheros que un clon limpio no tiene. Lo razonable es versionar los `.md` (son 456 líneas) y dejar fuera del repo solo los PDF pesados, si los hubiera. Hoy el `.gitignore` excluye la carpeta entera.
- 🟠 **`index_hard_docs.py` está roto en un clon limpio.** Indexa `18-…` y `19-…`, que no existen en ningún sitio, y `Path(file_path).stat()` está fuera del `try` que solo captura `DocumentoYaExiste`: el script muere con un `FileNotFoundError` y su *traceback*.
- 🟠 **Los dos scripts dicen «OK» cuando no han indexado nada.** Desde #45, `indexar_documento` devuelve `0` si el documento queda `duplicado` o `pendiente-decision`. El script imprime `OK: 0 fragmentos` y lo cuenta como indexado.
- 🟡 **`conversaciones_dificiles.json` no tiene consumidor**, y `backend/tests/README.md` describe `results/` como «reportes generados por las evaluaciones», cuando hoy nada los genera.
- 🟡 **El docstring de `index_all_docs.py` acepta `.pdf`, `.docx`, `.html` y `.txt`**, pero todo el corpus es `.md`.
- 🟡 **`search_chunks` anota `-> list[str]`** (`rag/retrieval.py:38`) y devuelve una lista de `dict`. Es un ejemplo de lo que mypy cazaría si estuviera en verde (día 19).
- 🟡 **Evaluar ensucia la base de datos.** Cada `/preguntar` sin `conversacion_id` crea una conversación nueva. 25 preguntas son 25 conversaciones en tu barra lateral. El script de hoy las borra con `DELETE /conversaciones/{id}` y, además, trabaja en una base de datos aparte.

---

## 4. Ejercicio (≈40 min)

Objetivo: tener **otra vez una medida reproducible** del RAG. Vas a recuperar el corpus, indexarlo en una colección y una base de datos **aparte** (sin tocar las tuyas), añadir un evaluador que solo habla con la API, ejecutar tres subconjuntos e interpretar los números.

He probado el script contra un servidor SSE falso que imita el contrato de `/preguntar`: parseo, métricas, borrado de conversaciones y código de salida con `--minimo`. También pasa `ruff check` con la configuración del backend. **No lo he podido ejecutar contra Gemini y Qdrant reales**, así que tus números serán los primeros.

### Paso 0 — Rama (1 min)

```bash
cd ~/ruta/a/AGENT4U
git fetch origin
git switch -c ejercicio/dia-20 origin/main
```

### Paso 1 — Recuperar el corpus (2 min)

```bash
ls backend/tests/data 2>/dev/null          # si ya tienes 18-* y 19-*, guárdalos aparte
git restore --source=fb93eea^ -- backend/tests/data/
ls backend/tests/data | wc -l              # 17 (o 19 si ya tenías los tuyos)
git status --short                         # vacío: la carpeta está en .gitignore
```

### Paso 2 — Entorno de evaluación aislado (3 min)

Todo lo que genere la evaluación va a `backend/tests/results/`, que también está ignorada. Así no mezclas el corpus de prueba con tus documentos ni con tus conversaciones.

```bash
docker compose up -d qdrant redis
cd backend
mkdir -p tests/results
export APP_QDRANT_COLLECTION=Agent4U_eval
export APP_DB_URL=sqlite:///./tests/results/eval.db
export APP_CONTENIDOS_DIR=./tests/results/contenidos
grep -c '^APP_GEMINI_API_KEY=.\+' .env     # 1: hace falta la clave real
```

Las variables de entorno ganan a `.env` en pydantic-settings (día 02). `COLLECTION_NAME` se lee al **importar** `vectorization.py`, así que tienen que estar exportadas antes de arrancar cada proceso, y en todos los terminales que uses.

### Paso 3 — Indexar (5 min)

```bash
uv run python tests/evaluation/index_all_docs.py
# ...
# Indexados: 17 | Omitidos: 0 | Fallidos: 0
```

Apunta en la entrega cuántos fragmentos salen de cada documento. Si alguno dice `OK: 0 fragmentos`, es la deduplicación de la sección 3: en el Paso 4 verás su `state`.

### Paso 4 — Arrancar la API contra ese entorno (2 min)

En **otro terminal**, con las mismas tres variables:

```bash
cd ~/ruta/a/AGENT4U/backend
export APP_QDRANT_COLLECTION=Agent4U_eval
export APP_DB_URL=sqlite:///./tests/results/eval.db
export APP_CONTENIDOS_DIR=./tests/results/contenidos
uv run uvicorn app.api.main:app --port 8000
```

Espera a `Application startup complete.` y comprueba en el primer terminal:

```bash
curl -s localhost:8000/documentos | python3 -c "
import sys, json
for d in json.load(sys.stdin)['documentos']:
    print(d['state'], d['num_chunks'], d['name'])"
# 17 líneas, todas 'indexado'
```

### Paso 5 — El evaluador (5 min)

Crea el fichero copiando y pegando el bloque entero:

```bash
cat > tests/evaluation/evaluar.py <<'EOF'
"""Evalua el RAG de punta a punta a traves de POST /preguntar.

No importa nada de `app`: habla con la API por HTTP y lee el stream SSE igual
que el frontend. Asi mide el sistema entero (grafo, retrieval, reranking y
prompt) y no se rompe cuando cambia la firma de una funcion interna.

No es un test de pytest (no empieza por test_): llama a Qdrant y al LLM reales.

Uso:
    uv run python tests/evaluation/evaluar.py --ids 2 7 14 23
    uv run python tests/evaluation/evaluar.py --tipos exacta ausente --minimo 0.8
    uv run python tests/evaluation/evaluar.py --preguntas tests/evaluation/response_file_dificil.json
"""

import argparse
import csv
import json
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import httpx

AQUI = Path(__file__).resolve().parent
RESULTADOS = AQUI.parent / "results"  # ignorada por git (.gitignore raiz)
FRASE_RECHAZO = "no encuentro esa informacion"  # la del SYSTEM_PROMPT_STREAMING
SIN_RESPUESTA = {"ausente", "trampa"}


def normalizar(texto: str | None) -> str:
    """Minusculas y sin tildes, para comparar sin depender de la ortografia."""
    if not texto:
        return ""
    sin_tildes = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return " ".join(sin_tildes.lower().split())


def preguntar(cliente: httpx.Client, pregunta: str, max_fragmentos: int | None) -> dict:
    """Lanza una pregunta y recoge todo lo que emite el stream."""
    cuerpo: dict = {"query": pregunta}
    if max_fragmentos is not None:
        cuerpo["max_fragmentos"] = max_fragmentos

    r = {"conversacion_id": None, "pasos": [], "fuentes": [], "texto": "", "error": None,
         "ms_fuentes": None, "ms_primer_texto": None}
    t0 = time.perf_counter()
    with cliente.stream("POST", "/preguntar", json=cuerpo) as resp:
        resp.raise_for_status()
        for linea in resp.iter_lines():
            if not linea.startswith("data: "):
                continue  # las lineas en blanco separan eventos
            evento = json.loads(linea[len("data: "):])
            ms = round((time.perf_counter() - t0) * 1000)
            tipo = evento["tipo"]
            if tipo == "inicio":
                r["conversacion_id"] = evento["conversacion_id"]
            elif tipo == "paso":
                r["pasos"].append(evento)
            elif tipo == "fuentes":
                r["fuentes"] = evento["fuentes"]
                r["ms_fuentes"] = ms
            elif tipo == "texto":
                if r["ms_primer_texto"] is None:
                    r["ms_primer_texto"] = ms
                r["texto"] += evento["texto"]
            elif tipo == "error":
                r["error"] = evento["mensaje"]
    r["ms_total"] = round((time.perf_counter() - t0) * 1000)
    return r


def puntuar(item: dict, r: dict) -> dict:
    """Convierte lo recogido en metricas de una pregunta."""
    nombres = [f["nombre"] for f in r["fuentes"]]
    esperado = item.get("documento_esperado")
    clave = normalizar(item.get("debe_contener"))
    respuesta = normalizar(r["texto"])
    # El primer 'evaluar' puntua la consulta original; si hubo reescrituras,
    # los siguientes puntuan las reescritas.
    evaluar = next((p for p in r["pasos"] if p["nodo"] == "evaluar"), {})

    fila = {
        "id": item["id"],
        "tipo": item["tipo"],
        "pregunta": item["pregunta"],
        "error": r["error"] or "",
        "n_fuentes": len(nombres),
        # Posicion (1..k) del primer fragmento del documento esperado, o vacio.
        "rango_doc": (nombres.index(esperado) + 1) if esperado in nombres else "",
        # Algun fragmento recuperado contiene literalmente la frase clave.
        "contexto_ok": bool(clave) and any(clave in normalizar(f["texto"]) for f in r["fuentes"]),
        "respuesta_contiene": bool(clave) and clave in respuesta,
        "rechaza": FRASE_RECHAZO in respuesta,
        "score_max": evaluar.get("score"),
        "reescrituras": sum(1 for p in r["pasos"] if p["nodo"] == "reescribir"),
        "ms_fuentes": r["ms_fuentes"],
        "ms_primer_texto": r["ms_primer_texto"],
        "ms_total": r["ms_total"],
        "respuesta": r["texto"].strip(),
        "respuesta_esperada": item["respuesta_esperada"],
    }
    # Acierto automatico: con respuesta, el documento correcto llega al
    # contexto y el modelo no se niega; sin respuesta, el modelo se niega.
    if item["tipo"] in SIN_RESPUESTA:
        fila["acierto"] = fila["rechaza"] and not fila["error"]
    else:
        fila["acierto"] = bool(fila["rango_doc"]) and not fila["rechaza"] and not fila["error"]
    return fila


def resumen(filas: list[dict]) -> float:
    """Imprime las metricas por tipo y devuelve la tasa de acierto global."""
    def fmt(v: float | None) -> str:
        return "  -  " if v is None else f"{v:5.2f}"

    def linea(nombre: str, grupo: list[dict]) -> None:
        con_doc = [f for f in grupo if f["tipo"] not in SIN_RESPUESTA]
        hit = sum(1 for f in con_doc if f["rango_doc"]) / len(con_doc) if con_doc else None
        mrr = sum(1 / f["rango_doc"] for f in con_doc if f["rango_doc"]) / len(con_doc) if con_doc else None
        acierto = sum(f["acierto"] for f in grupo) / len(grupo)
        ms = sorted(f["ms_total"] for f in grupo)
        print(f"{nombre:<22}{len(grupo):>3}  hit@k {fmt(hit)}  MRR {fmt(mrr)}  "
              f"acierto {acierto:5.2f}  p50 {ms[len(ms) // 2] / 1000:5.1f}s")

    print("\ntipo                    n")
    for tipo in sorted({f["tipo"] for f in filas}):
        linea(tipo, [f for f in filas if f["tipo"] == tipo])
    linea("TOTAL", filas)
    return sum(f["acierto"] for f in filas) / len(filas)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--preguntas", type=Path, default=AQUI / "response_file.json")
    p.add_argument("--ids", type=int, nargs="*", help="solo estas preguntas")
    p.add_argument("--tipos", nargs="*", help="solo estos tipos")
    p.add_argument("--api", default="http://localhost:8000")
    p.add_argument("--max-fragmentos", type=int, default=None)
    p.add_argument("--pausa", type=float, default=5.0, help="segundos entre preguntas (cupo del LLM)")
    p.add_argument("--minimo", type=float, default=None, help="sale con 1 si el acierto global queda por debajo")
    p.add_argument("--conservar", action="store_true", help="no borrar las conversaciones creadas")
    args = p.parse_args()

    items = json.loads(args.preguntas.read_text(encoding="utf-8"))
    if args.ids:
        items = [i for i in items if i["id"] in args.ids]
    if args.tipos:
        items = [i for i in items if i["tipo"] in args.tipos]
    if not items:
        sys.exit("Ninguna pregunta cumple el filtro.")

    filas = []
    with httpx.Client(base_url=args.api, timeout=httpx.Timeout(120, connect=5)) as cliente:
        for n, item in enumerate(items, start=1):
            print(f"[{n}/{len(items)}] #{item['id']} ({item['tipo']}) {item['pregunta'][:60]}")
            r = preguntar(cliente, item["pregunta"], args.max_fragmentos)
            fila = puntuar(item, r)
            filas.append(fila)
            marca = "OK " if fila["acierto"] else "MAL"
            print(f"    {marca} rango_doc={fila['rango_doc'] or '-'} contexto_ok={fila['contexto_ok']} "
                  f"rechaza={fila['rechaza']} score_max={fila['score_max']} {fila['ms_total']} ms")
            # Cada /preguntar crea una conversacion: se borra para no ensuciar la UI.
            if r["conversacion_id"] and not args.conservar:
                cliente.delete(f"/conversaciones/{r['conversacion_id']}")
            if n < len(items):
                time.sleep(args.pausa)

    global_ = resumen(filas)

    RESULTADOS.mkdir(parents=True, exist_ok=True)
    salida = RESULTADOS / f"eval-{datetime.now():%Y%m%d-%H%M%S}.csv"
    with salida.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0]))
        w.writeheader()
        w.writerows(filas)
    print(f"\nDetalle en {salida}")

    if args.minimo is not None and global_ < args.minimo:
        print(f"Acierto {global_:.2f} por debajo del minimo {args.minimo:.2f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
EOF
uv run ruff check tests/evaluation/evaluar.py      # All checks passed!
uv run python tests/evaluation/evaluar.py --help
```

Léelo antes de ejecutarlo. Hay tres decisiones que tienes que saber defender:

- **`acierto` para preguntas con respuesta** = el documento esperado está en `fuentes` **y** el modelo no se niega. No mira si el dato es correcto. Eso lo juzgas tú comparando las columnas `respuesta` y `respuesta_esperada` del CSV. Se queda deliberadamente corto: prefiero una métrica automática modesta y honesta a una que parezca lista, como el coseno de 0,85.
- **`contexto_ok`** usa `debe_contener` sobre el **texto de los fragmentos**, que es para lo que sirve ese campo (sección 2.1). Es más estricto que `rango_doc`, porque exige el fragmento correcto y no solo el documento correcto.
- **`--pausa 5`** por defecto. Cada pregunta hace entre 2 y 6 llamadas al LLM: multiconsulta y generación siempre, y otras dos (reescritura y multiconsulta) por cada vuelta del bucle. Sin pausa agotas el cupo por minuto de Gemini y los `error` se confunden con fallos del RAG.

### Paso 6 — Tres mediciones (15 min)

```bash
# A) Una de cada tipo y algo más, con k=10 (el valor por defecto)
uv run python tests/evaluation/evaluar.py --ids 2 7 10 14 20 21 23 24

# B) Las mismas, con k=3: ahora el retrieval tiene que ganarse el acierto
uv run python tests/evaluation/evaluar.py --ids 2 7 10 14 20 21 23 24 --max-fragmentos 3

# C) Lo difícil: vocabulario indirecto y trampas (todas con documento en el corpus 01-17)
uv run python tests/evaluation/evaluar.py --preguntas tests/evaluation/response_file_dificil.json \
    --ids 101 102 105 106 113 114 115 118
```

Copia en la entrega la tabla de resumen de las tres. Abre el CSV de la C (`tests/results/eval-*.csv`) y fíjate en tres columnas: `respuesta`, `score_max` y `reescrituras`.

### Paso 7 — Commit (2 min)

Solo el script. El corpus y los resultados están ignorados y deben seguir así:

```bash
git add backend/tests/evaluation/evaluar.py
git status --short                 # solo ese fichero
git commit -m "eval: evaluador de punta a punta contra POST /preguntar"
git push -u origin ejercicio/dia-20
```

Al terminar, en los dos terminales: `unset APP_QDRANT_COLLECTION APP_DB_URL APP_CONTENIDOS_DIR`. Si no lo haces, la próxima vez que arranques la API desde ese terminal verás el corpus de prueba en lugar de tus documentos.

### Bonus (opcional, 15 min)

1. **Umbral con datos.** Ejecuta todas las preguntas `ausente` y `trampa`, y una muestra de las que tienen respuesta. Ordena el CSV por `score_max`. ¿Hay algún valor que separe limpiamente las que tienen respuesta de las que no? ¿Está cerca del `0` de `nodo_evaluar`?
2. **Varianza.** Repite la medición A tres veces. ¿Cambia algún `acierto`? Ese ruido es tu margen de error: una diferencia menor que él entre dos configuraciones no significa nada.
3. **Arregla `index_hard_docs.py`** para que se salte con un aviso los ficheros que no existan, como ya hace `index_all_docs.py`.

### Preguntas (respóndelas con tus palabras en la entrega)

1. ¿Por qué murió el arnés anterior? Explica la diferencia entre acoplarse a `search_chunks()` y acoplarse a `POST /preguntar`, y qué pierdes con la segunda opción.
2. Compara A y B. ¿Qué preguntas pierden el documento al pasar de k=10 a k=3? ¿Cambia el MRR aunque no cambie el hit@k? ¿Qué te dice eso del reranker?
3. En la medición C, ¿alguna `trampa` contestó con un dato en lugar de rechazarla? Copia la respuesta. ¿Es un fallo de recuperación o de generación? Justifícalo con `rango_doc`, `contexto_ok` y el texto.
4. `debe_contener` se comprueba sobre los fragmentos y no sobre la respuesta. Da dos ejemplos del JSON en los que comprobarlo sobre la respuesta daría falsos negativos, y uno (mira la pregunta 20) en el que sería trivialmente cierto.
5. ¿Por qué un coseno de E5 ≥ 0,85 no es un buen criterio de acierto? Propón uno mejor que no use un LLM como juez para el tipo `exacta`.
6. Propón **la métrica mínima** que exigirías antes de mezclar un cambio en `retrieval.py`, el chunker o el prompt: qué preguntas, qué *k*, qué umbral y cuántas rondas. ¿Dónde la ejecutarías (en local, en un workflow manual o cada noche) y por qué no en cada push?

### Criterios de aceptación

- [ ] Existe `ejercicio/dia-20` en el remoto, creada desde `main`, con **un único fichero nuevo**: `backend/tests/evaluation/evaluar.py`. Ni `tests/data/` ni `tests/results/` están en el commit (`git show --stat HEAD`).
- [ ] La entrega incluye la salida final de `index_all_docs.py` (`Indexados: … | Omitidos: … | Fallidos: …`).
- [ ] La entrega incluye las **tres tablas de resumen** (A, B y C) tal como las imprime el script.
- [ ] La entrega incluye al menos una respuesta real copiada del CSV de C, con tu juicio de si es correcta.
- [ ] Al terminar no queda ninguna conversación de la evaluación: `curl -s localhost:8000/conversaciones` devuelve `[]` contra `eval.db`.
- [ ] Las 6 preguntas están respondidas con tus palabras. La 6 propone números concretos.
- [ ] El párrafo para `ARCHITECTURE.md` está en la entrega.

### Entrega: antes de las 8:30 del domingo 29-nov

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-20.md
# ...rellénala...
git add docs/aprendizaje/entregas/dia-20.md
git commit -m "entrega día 20" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code (con `XX` = `20`) estando en tu rama `ejercicio/dia-20`.

---

## 5. Para profundizar (opcional)

- Ficha de `intfloat/multilingual-e5-large`. En el FAQ explica por qué sus similitudes coseno se concentran entre 0,7 y 1,0: <https://huggingface.co/intfloat/multilingual-e5-large>
- RAGAS, métricas de evaluación de RAG con un LLM como juez (*faithfulness*, *context precision/recall*). Es lo que el README da como alternativa: <https://docs.ragas.io/>

---

## 6. Aportación a `ARCHITECTURE.md`

Hoy completas la sección *12. Testing y evaluación* con la parte de evaluación. Tu párrafo debería cubrir:

- La diferencia entre tests (lógica, con dobles, en CI) y evaluación (calidad, con modelos reales, fuera de pytest por `python_files`), y por qué cada una vive donde vive.
- Los tres sets (25 preguntas en 5 tipos, 18 difíciles en 3 tipos y 5 conversaciones), qué mide cada tipo, y que `debe_contener` comprueba el contexto y no la respuesta.
- Que el corpus no está versionado (se recupera de `fb93eea^`, y faltan el 18 y el 19) y que el arnés antiguo murió por estar acoplado a funciones internas.
- Tu evaluador: habla con `POST /preguntar`, mide hit@k, MRR, rechazo y latencia, trabaja en una colección y una base de datos aparte, y tus primeros números como línea base.

**El domingo 29-nov (día 21, sesión larga):** el sitio editorial (`src/sitio/*`) y un repaso de la deuda técnica de todo el repo. Juntaremos todas las «cosas que no cuadran» de las 20 píldoras. El ejercicio será construir un inventario priorizado por riesgo y coste, con las zonas que no tocarías sin tests delante, y decidir cuáles van primero.
