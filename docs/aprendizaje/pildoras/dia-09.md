# Píldora 09 — Prompt, LiteLLM y streaming SSE

**Jueves 5-nov-2026 · 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 08

No hay entrega del día 08: en `origin/aprendizaje` no existe `entregas/dia-08.md` y en el remoto no hay ninguna rama `ejercicio/dia-*`. Tampoco han llegado tarde las anteriores (02 a 07). Sin nota.

El ejercicio de hoy, como el del martes, **no necesita Docker, modelos ni clave de Gemini**. Basta con `uv sync`, pytest y un servidor de demostración que monta el router real de `/preguntar` y el grafo real con dobles en lugar de la búsqueda y del LLM. Si un fin de semana recuperas el 08, no choca con este: tocan ficheros distintos.

`main` sigue en `fb93eea` (21-oct). Todo lo que sigue lo he comprobado hoy contra ese código y contra las versiones que fija `backend/uv.lock`: `litellm 1.96.0`, `fastapi 0.139.2` y `starlette 1.3.1`. Las trazas con tiempos salen de ejecutar ese código.

---

## 1. Concepto clave: una respuesta HTTP que no termina

### 1.1 Server-Sent Events en cinco líneas

Una petición HTTP normal funciona así: el servidor calcula y luego responde. Con un LLM eso son 5-15 s de pantalla quieta. **SSE** (*Server-Sent Events*) es HTTP corriente con dos diferencias:

- La respuesta lleva `Content-Type: text/event-stream` y **no tiene longitud conocida**. En HTTP/1.1 viaja con `Transfer-Encoding: chunked`, y el servidor va escribiendo trozos mientras la conexión sigue abierta.
- El cuerpo es texto con un formato mínimo: líneas `campo: valor`, y **una línea en blanco cierra cada evento**. El estándar define cuatro campos: `data`, `event`, `id` y `retry`. AGENT4U solo usa `data`, y dentro mete un JSON con un campo `tipo`.

```text
data: {"tipo": "inicio", "conversacion_id": 62473}

data: {"tipo": "texto", "texto": "El teorema "}

```

El navegador trae `EventSource` para consumir SSE, pero **solo hace GET** y no admite cuerpo. `/preguntar` es un POST con JSON, así que el frontend lee el stream a mano con `fetch` y un `ReadableStream`. Lo verás en 2.7.

### 1.2 SSE frente a las alternativas

| | SSE | WebSocket | *Polling* |
|---|---|---|---|
| Dirección | servidor → cliente | las dos | cliente pregunta |
| Protocolo | HTTP normal | *upgrade* a otro protocolo | HTTP normal |
| Proxies y nginx | pasan, si **no** hacen búfer | hay que configurar el *upgrade* | pasan |
| Coste en el servidor | una conexión por respuesta | una conexión persistente | N peticiones por respuesta |

Una respuesta de LLM es unidireccional y termina, que es justo el caso de SSE. El enemigo de SSE es el **búfer**: cualquier intermediario que acumule la respuesta antes de reenviarla (nginx, un proxy, el propio `curl`) convierte el streaming en una espera larga con todo de golpe al final.

### 1.3 La trampa del 200

El código de estado HTTP y las cabeceras viajan **con el primer byte** de la respuesta. Cuando el servidor emite `inicio`, el cliente ya ha recibido `200 OK` y ese código no se puede cambiar. A partir de ahí, un fallo solo tiene dos formas de llegar:

1. **Como un evento más** (`{"tipo": "error"}`), y el stream se cierra limpio. El cliente sabe qué ha pasado.
2. **Cortando la conexión.** El cliente ve un stream roto y no sabe por qué.

Regla de diseño: **todo lo que pueda fallar de forma previsible se comprueba antes de abrir el stream**, y devuelve un código HTTP de verdad (404, 422). Lo que solo puede fallar después (el LLM) tiene que salir como evento. Hoy verás que AGENT4U cumple la regla en la generación y la incumple en el grafo.

### 1.4 `StreamingResponse` con un generador síncrono

FastAPI (que usa Starlette por debajo) acepta como cuerpo de un `StreamingResponse` cualquier iterable. Si el generador es **síncrono** (`def` con `yield`), Starlette lo recorre con `iterate_in_threadpool`: cada `next()` se ejecuta en un hilo del pool, y lo que devuelve se escribe en el socket. Tres consecuencias:

- El código del generador **no se ejecuta cuando el endpoint devuelve**, sino cuando Starlette pide el siguiente trozo. Lo que esté antes del primer `yield` corre en el primer `next()`.
- Mientras un `next()` espera al LLM, ese hilo está ocupado. El pool de AnyIO tiene 40 hilos por defecto, y lo comparten todos los endpoints `def` de la API.
- Si el cliente se desconecta, Starlette deja de pedir trozos. El código que va **después** del bucle no llega a ejecutarse nunca.

### 1.5 LiteLLM en una frase

LiteLLM expone **una sola función con la forma de la API de OpenAI**, `litellm.completion(model="proveedor/modelo", messages=[{"role": ..., "content": ...}], stream=...)`, y la traduce a la API de cada proveedor. El prefijo de `model` (`gemini/`) elige el proveedor; la clave la busca en variables de entorno con el nombre del proveedor (`GEMINI_API_KEY` o `GOOGLE_API_KEY`), salvo que le pases `api_key=`. Con `stream=True` devuelve un iterador de trozos con la forma `trozo.choices[0].delta.content`.

---

## 2. Cómo está en AGENT4U

### 2.1 El recorrido completo

```text
POST /preguntar  (routers/query.py:86, def síncrono)
 │  validación ANTES de abrir el stream → 422 modelo, 422 max_fragmentos, 404 conversación
 ▼
query_service.responder (:43)  ── trabajo de BD fuera del generador (:54-58)
 │  crea o recupera la conversación · lee los últimos 6 mensajes · GUARDA la pregunta
 ▼
StreamingResponse(generar())   ── a partir de aquí ya se ha enviado el 200
 │
 ├─ inicio   (:66)                       {"conversacion_id"}
 ├─ paso ×N  (:74-93)  grafo.stream(…, "updates") → un evento por nodo
 │
 └─ streaming.responder_stream (:34)
     ├─ fuentes                          fragmentos finales con texto y score
     ├─ texto ×N   litellm.completion(stream=True), un evento por trozo
     ├─ (si falla el LLM) error → return       ← no se guarda nada
     ├─ guarda la respuesta en la BD (:66-71)
     └─ fin
```

Seis tipos de evento: `inicio`, `paso`, `fuentes`, `texto`, `error` y `fin`.

### 2.2 El router: todo lo previsible, antes del stream

`routers/query.py:86-120`:

```python
def preguntar(body: QueryRequest, request: Request, db: Annotated[Session, Depends(get_db)]):
    settings = get_settings()

    # Lista blanca: aceptar cualquier cadena dejaria que el cliente apunte a un
    # modelo caro o inexistente, y el fallo saldria a mitad del stream.
    modelo = body.modelo or settings.llm_model
    if modelo not in _modelos_permitidos():
        raise HTTPException(status_code=422, ...)

    if body.max_fragmentos is not None and body.max_fragmentos > settings.max_fragmentos_tope:
        raise HTTPException(status_code=422, ...)

    try:
        generador = responder(...)
    except ConversacionNoEncontrada as e:
        raise HTTPException(status_code=404, detail=str(e))

    return StreamingResponse(generador, media_type="text/event-stream")
```

El comentario de la lista blanca es exactamente la regla de 1.3: un modelo inexistente se rechaza con un 422 **antes** de abrir el stream, no a mitad. Lo comprobé con el servidor de demostración: `"modelo": "gpt-5"` → `422`, y `"conversacion_id": 1` → `404 {"detail":"Conversación con ID '1' no encontrada"}`.

La conversación inexistente sale como 404 porque `responder` **no es un generador**: es una función normal que hace el trabajo de BD y *devuelve* un generador. Si `responder` tuviera un `yield` en su cuerpo, la excepción saltaría en el primer `next()`, con el 200 ya enviado.

### 2.3 `query_service.responder`: la BD fuera, los pasos dentro

`services/query_service.py:54-66`:

```python
    conv = obtener_o_crear_conversacion(db, conversacion_id, query)
    historial = conversation_crud.obtener_ultimos_mensajes(db, conv.id, limit=6)
    conversation_crud.anadir_mensaje(db, conv.id, rol="user", contenido=query)
    # Se guarda el entero, no el objeto: fuera de la sesion queda desligado.
    conv_id = conv.id
    ...
    def generar() -> Iterator[str]:
        yield traductor_evento("inicio", {"conversacion_id": conv_id})
```

Tres detalles con intención:

- El historial se lee **antes** de guardar la pregunta, así que no incluye la pregunta actual. Si fuera al revés, el LLM la recibiría dos veces.
- `inicio` sale **antes** de ejecutar el grafo. Para una conversación nueva es la única forma de que el cliente conozca su id, y el frontend lo guarda en cuanto llega (`useConversacion.ts:108-119`, con un comentario largo de por qué no puede esperar).
- El bucle de `paso` (`:74-93`) ya lo viste el martes: recompone a mano `chunks` y `messages` y emite las cifras de `datos_del_paso`.

### 2.4 `streaming.py`: fuentes, tokens y el único `try`

```python
def traductor_evento (tipo: str, datos: dict) -> str:
    return f"data: {json.dumps({'tipo': tipo, **datos}, ensure_ascii=False)}\n\n"
```

Toda la serialización SSE de AGENT4U es esta línea (`streaming.py:8-9`). `ensure_ascii=False` deja las tildes en UTF-8 en vez de `é`, y el `\n\n` final es el separador de eventos.

`responder_stream` (`:34-75`) emite primero `fuentes`, y después:

```python
        partes: list[str] = []
        try:
            stream = litellm.completion(model=model, messages=messages, stream=True)
            for trozo in stream:
                texto = trozo.choices[0].delta.content
                if not texto:
                    continue
                partes.append(texto)
                yield traductor_evento("texto", {"texto": texto})
        except Exception as e:
            yield traductor_evento("error", {"mensaje": str(e)})
            return

        completa = "".join(partes)
        with SessionLocal() as sesion:
            conversation_crud.anadir_mensaje(sesion, conversacion_id, rol="assistant",
                                             contenido=completa, fuentes=fuentes)

        yield traductor_evento("fin", {})
```

- El `try` envuelve **la llamada y la iteración**. Un 429 al empezar y un corte a mitad acaban igual: evento `error` y `return`.
- La respuesta se acumula en `partes` y **solo se guarda si el stream termina bien**. Una respuesta a medias no queda en la BD.
- Usa su **propio** `SessionLocal()`, no la sesión del request. El docstring de `responder` explica por qué, y en la sección 3 verás que esa explicación ya no es cierta con FastAPI 0.139.
- `fuente_desde_chunk` (`:12-31`) manda al cliente el texto del fragmento, el score y la subconsulta que lo encontró. Su docstring cuenta que antes se descartaban.

### 2.5 Las cuatro llamadas al LLM

| Dónde | Función | Prompt | Cuándo | `stream` | Si falla |
|---|---|---|---|---|---|
| `generation.py:13` | `reformular_consulta` | `prompt_reformular`: **todo en un mensaje `user`**, sin system | solo con historial | no | excepción dentro del grafo |
| `generation.py:30` | `descomponer_consulta` | `SYSTEM_PROMPT_MULTICONSULTA` + pregunta, pide JSON | **siempre** | no | el `try` (`:34-40`) solo protege el parseo |
| `generation.py:22` | `reescribir_consulta` | `SYSTEM_PROMPT_REESCRIBIR` + consulta | si `decidir` lo pide | no | excepción dentro del grafo |
| `streaming.py:51` | `responder_stream` | `generate_query` (abajo) | siempre | **sí** | evento `error` |

El prompt de la respuesta lo arma `prompt.generate_query` (`prompt.py:71-85`), que llama el nodo `construir` (`grafo_nodes.py:97-105`):

```python
    messages = [{"role": "system", "content": SYSTEM_PROMPT_STREAMING}]
    for m in historial:
        messages.append({"role": m.rol, "content": m.contenido})
    messages.append({"role": "user", "content": f"Contexto:\n{context}\n\nPregunta: {query}"})
```

- `SYSTEM_PROMPT_STREAMING` (`prompt.py:2-10`): solo el contexto, frase fija si no está la respuesta, una excepción para preguntas sobre si dos temas ya tratados se relacionan, y **prosa sin números de cita**, porque las fuentes las pinta la UI.
- El contexto (`build_context`, `:38-49`) numera cada fragmento: `[1] (Documento: x.pdf, Página: 7, Url: N/A)\n<texto>`.
- La pregunta que recibe el LLM es `estado["query"]`, **la original del usuario**, no la reformulada. Tiene sentido: el historial va completo en los mensajes, así que el modelo resuelve los pronombres por su cuenta; la reformulación solo sirve para buscar mejor.

### 2.6 La traza real

Servidor de demostración (el del ejercicio): router real, grafo real, búsqueda doblada a 100 ms y LLM doblado a un trozo cada 300 ms. Columna izquierda: segundos desde que empieza `curl -N`.

```text
 0.02 data: {"tipo": "inicio", "conversacion_id": 62473}
 0.03 data: {"tipo": "paso", "nodo": "reformular", "ms": 5}
 0.03 data: {"tipo": "paso", "nodo": "multiconsulta", "ms": 1, "subconsultas": 1}
 0.13 data: {"tipo": "paso", "nodo": "buscar", "ms": 102, "fragmentos": 1}
 0.13 data: {"tipo": "paso", "nodo": "fusionar", "ms": 1, "fragmentos": 1}
 0.13 data: {"tipo": "paso", "nodo": "evaluar", "ms": 1, "score": 2.0, "pobre": false}
 0.13 data: {"tipo": "paso", "nodo": "construir", "ms": 1}
 0.13 data: {"tipo": "fuentes", "fuentes": [{"nombre": "cap.pdf", ... "subconsulta": "¿Qué es CAP?"}]}
 0.43 data: {"tipo": "texto", "texto": "El teorema "}
 0.73 data: {"tipo": "texto", "texto": "CAP "}
 ...
 2.54 data: {"tipo": "texto", "texto": "todo."}
 2.54 data: {"tipo": "fin"}
```

Las cabeceras: `200 OK`, `content-type: text/event-stream; charset=utf-8`, `transfer-encoding: chunked`. **Sin `-N`**, la misma petición enseña la primera y la última línea a los 2,56 s: `curl` acumula la salida cuando escribe en una tubería, y eso es justo el búfer de 1.2.

Los tres finales posibles, medidos:

| Caso | Lo que llega | `curl` | BD después |
|---|---|---|---|
| Todo bien | … `texto` ×8, `fin` | sale con 0 | `user` + `assistant` |
| Gemini se corta en el 4.º trozo | … `texto` ×3, `error: litellm.APIConnectionError: se cortó Gemini` | sale con 0 | **solo `user`** |
| 429 en `multiconsulta` (dentro del grafo) | `inicio`, `paso reformular`… **y se corta** | **sale con 18** (*partial file*) | **solo `user`** |
| El cliente cierra a los 1,2 s | — | — | **solo `user`**; el servidor pidió **un** trozo más al LLM y paró |

En el tercer caso, uvicorn registra `ERROR: Exception in ASGI application … RateLimitError` y cierra el socket sin el trozo final del *chunked*. El cliente no recibe ningún evento que diga qué ha pasado.

### 2.7 El otro lado del cable

- **Gateway** (`gateway/app/proxy.py:8-36`): reenvía **bytes** (`resp.aiter_bytes()`) sin interpretar nada, con un `httpx.AsyncClient(timeout=None)` (`gateway/app/main.py:18-20`). Si el backend responde algo distinto de 200 antes de abrir el stream (el 404 o el 422), lo convierte en `HTTPException` con el mismo código.
- **nginx** (`frontend/despliegue/nginx.conf:46-50`): `proxy_buffering off`, `proxy_cache off` y `proxy_read_timeout 1h`. El comentario dice lo que pasaría sin ellas: la respuesta llegaría de golpe al final.
- **Frontend** (`frontend/src/shared/api/preguntar.ts`): lee con `getReader()`, parte por `'\n\n'` y **guarda el último trozo** para la vuelta siguiente, porque un `read()` puede cortar un evento por la mitad (`:83-92`). `parsearEventoSSE` es pura y devuelve `null` ante un bloque corrupto. `TIPOS` (`:17`) es una lista blanca: un evento nuevo que no esté ahí se pierde en silencio, y el comentario lo avisa.
- `useConversacion.ts:141-143`: si el stream se cierra sin `fin` ni `error`, despacha `fin` para no dejar la UI en "enviando" para siempre.

---

## 3. Por qué se montó así (y qué no cuadra)

### Decisiones

1. **SSE y no WebSocket.** La respuesta es unidireccional y termina; SSE es HTTP normal, pasa por el gateway como bytes y por nginx con tres líneas. Un WebSocket habría exigido *upgrade* en nginx y en el gateway, y gestionar a mano reconexión y cierre. *Coste:* hay que pelear con los búferes, y al ser POST no sirve `EventSource`: el parser del frontend es código propio.

2. **Un solo campo `data` con JSON y un `tipo`, sin el campo `event:` del estándar.** Así el contrato se describe con una unión discriminada de Pydantic (`schemas.py:498-501`, `Field(discriminator="tipo")`) y en el frontend es un `switch` sobre `evento.tipo` con tipos de TypeScript. Con `event:`, el tipo iría fuera del JSON y habría dos sitios que parsear. *Coste:* se renuncia a `id:` y `retry:`, es decir, a reanudar un stream cortado. Para una respuesta de LLM, que no se puede reanudar a mitad, no se pierde nada.

3. **LiteLLM y no el SDK de Google.** Cambiar de proveedor es cambiar la cadena `APP_LLM_MODEL` (así lo vende el `README.md:41`), y los mensajes van en formato OpenAI, que es el que conoce todo el mundo. *Coste:* una dependencia enorme que se actualiza casi a diario, que ejecuta `load_dotenv()` al importarse (`litellm/__init__.py:26-27`) y que lee la clave de variables de entorno con su propio nombre, que es la raíz del 🔴 del día 02.

4. **`fuentes` antes que `texto`.** La UI puede pintar el panel de fuentes mientras se escribe la respuesta, y las fuentes ya están calculadas al salir del grafo. El prompt prohíbe las citas en el texto precisamente porque las fuentes van aparte.

5. **Persistir solo si se termina bien.** Una respuesta a medias en el historial contaminaría el siguiente turno. *Coste:* la pregunta sí se guarda siempre (ver 🟠).

6. **Endpoint síncrono.** Todo el pipeline es bloqueante (fastembed, el cliente síncrono de Qdrant, `litellm.completion`), así que un `def` es lo honesto: un `async def` con llamadas bloqueantes dentro congelaría el *event loop*. *Coste:* cada pregunta en curso ocupa un hilo del pool de 40 casi todo el tiempo. La alternativa (`litellm.acompletion`, `grafo.astream`, cliente asíncrono de Qdrant) es una migración entera, no un cambio.

### Cosas que no cuadran (comprobadas hoy contra `main`)

- 🔴 **Un fallo dentro del grafo corta el stream sin evento `error`.** Tres de las cuatro llamadas al LLM (`reformular`, `multiconsulta` y `reescribir`) se ejecutan dentro de `grafo.stream`, y el bucle de `query_service.py:74` no tiene `try`. Con el 200 ya enviado, la excepción sube hasta uvicorn, que cierra la conexión a medias (`curl` sale con 18). El gateway reenvía bytes, así que el corte llega igual al navegador: lo más probable es que el frontend lo pinte como un error de red y no como el error del modelo que es. Y como `multiconsulta` se ejecuta **en todas las preguntas**, un 429 de Gemini aquí es lo más probable en cuanto pases del cupo gratuito. Lo arreglas hoy.

- 🔴 **Sigue abierto desde el día 02: la clave no llega a LiteLLM.** `Settings.gemini_api_key` no se lee en ningún sitio y ninguna de las 4 llamadas pasa `api_key=`. LiteLLM 1.96 busca `GOOGLE_API_KEY` o `GEMINI_API_KEY` (`litellm/llms/gemini/common_utils.py:368`). Para probar con Gemini de verdad necesitas `export GEMINI_API_KEY=...` además de la variable `APP_`.

- 🟠 **El modelo que eliges en la UI solo se usa en la respuesta final.** El grafo se compila una vez en el `lifespan` con `model=settings.llm_model` (`lifespan.py:65-71`), y `responder` solo le pasa `model` a `responder_stream`. Si pides `gemini-flash-latest`, las llamadas de reformular, descomponer y reescribir siguen yendo a `flash-lite`. Puede ser buena idea (lo auxiliar, barato), pero no lo dice nadie: ni `/ajustes` ni la descripción del endpoint.

- 🟠 **Preguntas huérfanas.** La pregunta se guarda en `:56`, antes de empezar. Si falla el LLM, falla el grafo o el usuario cierra la pestaña, en la BD queda un `user` sin `assistant` (lo verifiqué en los tres casos). En el siguiente turno del mismo hilo, el historial lleva **dos mensajes `user` seguidos**, y el primero nunca tuvo respuesta. Además, en el corte del cliente se pierde también el texto parcial, aunque el usuario ya lo había leído en pantalla.

- 🟠 **El contrato publicado no tiene `paso`.** `schemas.py` define 5 eventos y la unión `EventoSSE` no incluye `paso`, que llegó con `2708dec` (19-oct) sin tocar el esquema. La descripción del endpoint (`query.py:59`) dice *"Orden garantizado: `inicio`, `fuentes`, N x `texto`…"*, sin `paso`, y el mismo texto está copiado en `preguntar.ts:51-52`. El frontend sí tiene `EventoPaso` en `shared/api/types.ts:114`. Es decir: el OpenAPI miente por omisión justo en el evento más numeroso. Lo arreglas hoy.

- 🟠 **El docstring de `responder` describe otra versión de FastAPI.** Dice que la sesión de `get_db` *"se cierra en cuanto el endpoint devuelve"*. Era verdad entre FastAPI 0.106 y 0.117. Con la 0.139.2 del `uv.lock` lo medí: una dependencia con `yield` se cierra **después** del stream (`['dep abre', 'stream 0', 'stream 1', 'dep cierra']`). O sea, la sesión del request sigue abierta durante toda la generación, y `streaming.py` abre otra encima. Si se quiere el comportamiento que describe el comentario, existe `Depends(get_db, scope="function")`, que la cierra antes de enviar la respuesta (también lo comprobé: `['dep abre', 'dep cierra', 'stream 0', …]`).

- 🟠 **El README describe la generación de hace dos meses.** La sección *Generación* (`README.md:318-329`) habla de `generate_response()` en `generation.py`, que no existe (`build_context` está en `prompt.py`), y copia un system prompt que **obliga** a citar con `[documento]`. Las citas se quitaron el 1-sep (`e15afc0`), y el prompt actual las prohíbe. Lo mismo en `README.md:41`: *"Generación con citas obligatorias"*.

- 🟡 **Sin tiempo límite en ningún tramo.** Ninguna llamada pasa `timeout`, así que LiteLLM usa 600 s (`litellm/constants.py`, `COMPLETION_HTTP_FALLBACK_SECONDS`). El gateway tiene `timeout=None`, el frontend `tiempoLimiteMs: 0` y nginx una hora. Si Gemini se cuelga, el usuario mira la línea de tiempo diez minutos. Tampoco hay `num_retries`: un 429 puntual no se reintenta.

- 🟡 **`str(e)` llega al usuario tal cual.** El `error` muestra `litellm.APIConnectionError: …` o el cuerpo de error del proveedor. Para un proyecto personal da igual. En producción, el detalle va al log y al usuario le llega un mensaje genérico.

- 🟡 **El contexto entra sin delimitar.** Los fragmentos se interpolan en el mismo mensaje `user` que la pregunta. Un PDF que contenga *"Ignora las instrucciones anteriores y…"* llega al modelo con el mismo peso que el usuario: es la **inyección de prompt indirecta**, el riesgo número uno de un RAG. Delimitar el contexto (etiquetas `<contexto>…</contexto>`) y decir en el system prompt que su contenido son datos y no órdenes no lo resuelve del todo, pero lo dificulta.

- 🟡 **Detalles de los prompts.** `prompt_reformular` va entero en un mensaje `user`, sin system, al contrario que los otros dos. `SYSTEM_PROMPT_REESCRIBIR` y `SYSTEM_PROMPT_MULTICONSULTA` llevan 4 espacios de sangría en cada línea porque están indentados dentro de las comillas triples, y así se envían. No rompe nada, pero son tokens y ruido.

- 🟡 **Parámetros muertos.** `responder` recibe `dense_embedder`, `sparse_embedder`, `cross_encoder` y `qdrant`, y no usa ninguno: el grafo ya los tiene en sus clausuras. El router los saca de `app.state` y se los pasa para nada. Además, `response_class=EventStreamResponse` (`query.py:52`) solo afecta a la documentación, porque la función devuelve su propio `StreamingResponse`. Tampoco se documenta el 422.

- 🟡 **Faltan las cabeceras de SSE.** No se envía `Cache-Control: no-cache` ni `X-Accel-Buffering: no`. Funciona porque el `nginx.conf` del proyecto desactiva el búfer, pero detrás de cualquier otro proxy la respuesta volvería a llegar de golpe.

---

## 4. Ejercicio (40 min): mira el stream con `curl -N` y haz que un fallo del grafo llegue como evento

**Rama de código:** `ejercicio/dia-09`, creada desde `main`.
**Entrega:** `docs/aprendizaje/entregas/dia-09.md`, en la rama `aprendizaje`, **antes de las 8:30 del sábado 7-nov**.

Vas a: (1) levantar un servidor de demostración y leer el stream evento a evento, con tiempos, en sus tres finales; (2) escribir **primero** dos tests en rojo; (3) arreglar el 🔴 del grafo y documentar `paso` en el contrato; (4) comprobar con `curl` que el corte se ha convertido en un evento `error`. Sin Docker, sin modelos y sin clave.

### Paso 1 — Rama y punto de partida (3 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-09 origin/main
cd backend
uv sync
uv run pytest -q          # punto de partida: 91 passed
```

### Paso 2 — El stream en directo, con sus tres finales (12 min)

Crea el servidor de demostración **fuera del repo**, para que no acabe en el commit. Monta el router real de `/preguntar` y el grafo real, y sustituye la búsqueda y `litellm.completion` por dobles. `MODO` elige cómo falla:

```bash
mkdir -p /tmp/agent4u-sse
cat > /tmp/agent4u-sse/servidor.py <<'EOF'
"""Router real de /preguntar + grafo real, con dobles de búsqueda y de LLM."""
import os
import time
from types import SimpleNamespace

import litellm
from fastapi import FastAPI

from app.api.routers import query
from app.db.session import crear_esquema
from app.rag.grafo import grafo_nodes
from app.rag.grafo.grafo_create import crear_grafo

MODO = os.environ.get("MODO", "ok")   # ok | falla_mitad | falla_grafo


def buscar_falso(*args, **kwargs):
    time.sleep(0.1)
    return [{"nombre": "cap.pdf", "origen": "/docs/cap.pdf", "headings": ["CAP"],
             "paginas": [7], "chunk": "El teorema CAP dice que...", "score": 2.0, "url": None}]


def completion_falsa(*, model, messages, stream=False, **kwargs):
    if not stream:  # las llamadas del grafo
        if MODO == "falla_grafo":
            raise litellm.RateLimitError("429 en multiconsulta", llm_provider="gemini", model=model)
        texto = '{"subconsultas": ["¿Qué es CAP?"]}'
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=texto))])

    def trozos():  # la generación final
        palabras = ["El teorema ", "CAP ", "dice ", "que ", "no ", "puedes ", "tenerlo ", "todo."]
        for i, palabra in enumerate(palabras):
            time.sleep(0.3)
            if MODO == "falla_mitad" and i == 3:
                raise litellm.APIConnectionError("se cortó Gemini", llm_provider="gemini", model=model)
            print(f"[llm] trozo {i}", flush=True)
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=palabra))])
    return trozos()


grafo_nodes.search_chunks = buscar_falso
litellm.completion = completion_falsa
crear_esquema()

app = FastAPI()
app.include_router(query.router)
app.state.grafo = crear_grafo(None, None, None, None, "gemini/falso")
for nombre in ("dense_embedder", "sparse_embedder", "cross_encoder", "qdrant"):
    setattr(app.state, nombre, None)
EOF
```

Fíjate en que el doble de LLM sustituye `litellm.completion` en el **módulo** `litellm`, y que `generation.py` y `streaming.py` lo llaman como `litellm.completion(...)` (atributo del módulo, resuelto en cada llamada). Por eso basta un parche para las cuatro llamadas. Con `search_chunks` es al revés: `grafo_nodes` hizo `from … import search_chunks`, y hay que parchear su copia (la pregunta 8 del martes).

Arráncalo en una terminal, desde `backend/`. `APP_DB_URL` apunta a una BD de usar y tirar para no ensuciar tu `agent4u.db`:

```bash
cd ~/ruta/AGENT4U/backend
APP_DB_URL=sqlite:////tmp/agent4u-sse/demo.db PYTHONPATH=/tmp/agent4u-sse:. MODO=ok \
  uv run uvicorn servidor:app --port 8001
```

En otra terminal, la pregunta con marca de tiempo (el `perl` funciona igual en macOS y en Linux; `date +%N` no existe en macOS):

```bash
SELLO='BEGIN{$t0=time} printf "%5.2f %s", time-$t0, $_ if /\S/'
PREGUNTA='{"query": "¿Qué es CAP?"}'

curl -sN -D - -X POST localhost:8001/preguntar -H 'Content-Type: application/json' -d "$PREGUNTA" \
  | perl -MTime::HiRes=time -ne "$SELLO"

# la misma, SIN -N: ¿cuándo llega la primera línea?
curl -s -X POST localhost:8001/preguntar -H 'Content-Type: application/json' -d "$PREGUNTA" \
  | perl -MTime::HiRes=time -ne "$SELLO" | sed -n '1p;$p'

# errores ANTES del stream: códigos HTTP de verdad
curl -s -w ' → %{http_code}\n' -X POST localhost:8001/preguntar -H 'Content-Type: application/json' \
  -d '{"query": "x", "modelo": "gpt-5"}'
curl -s -w ' → %{http_code}\n' -X POST localhost:8001/preguntar -H 'Content-Type: application/json' \
  -d '{"query": "x", "conversacion_id": 1}'
```

Ahora los otros dos finales. Para el servidor (Ctrl+C), arráncalo con `MODO=falla_mitad` y luego con `MODO=falla_grafo`, y en cada caso lanza:

```bash
curl -sN -X POST localhost:8001/preguntar -H 'Content-Type: application/json' -d "$PREGUNTA"; echo "curl salió con $?"
```

Por último, con `MODO=ok`, corta tú la conexión a mitad y mira la terminal del servidor:

```bash
timeout 1.2 curl -sN -X POST localhost:8001/preguntar -H 'Content-Type: application/json' -d "$PREGUNTA"
# macOS sin coreutils: lánzalo sin timeout y pulsa Ctrl+C cuando salga el 2.º "texto"
```

Y mira qué ha quedado en la BD:

```bash
uv run python -c "
import sqlite3
c = sqlite3.connect('/tmp/agent4u-sse/demo.db')
for fila in c.execute('select conversacion_id, rol, substr(contenido, 1, 30) from mensajes order by creado_en'):
    print(fila)"
```

En la entrega: pega la traza con tiempos y **etiqueta cada tipo de evento** (`inicio`, `paso`, `fuentes`, `texto`, `error` y `fin`) diciendo quién lo emite (fichero y línea). Pega las cabeceras, el código de salida de `curl` en los tres modos, las líneas `[llm] trozo` del corte y la salida de la BD.

### Paso 3 — Los tests primero, en rojo (8 min)

Añade al **final** de `backend/tests/integration/test_query_service.py`:

```python
class GrafoQueRevienta:
    """Emite un tramo y despues falla, como un 429 de Gemini en `multiconsulta`."""

    def __init__(self, error: Exception):
        self.error = error

    def stream(self, estado: dict, stream_mode: str = "values"):
        yield {"reformular": {"consulta_busqueda": estado["query"]}}
        raise self.error


def test_si_el_grafo_falla_se_emite_un_evento_error_y_nada_mas(db, llm, parsear_sse):
    grafo = GrafoQueRevienta(RuntimeError("el proveedor devolvio 429"))

    eventos = parsear_sse(list(preguntar(db, grafo)))

    assert [e["tipo"] for e in eventos] == ["inicio", "paso", "error"]
    assert "429" in eventos[-1]["mensaje"]
    # Ni fuentes ni generacion: el LLM de la respuesta no se llega a llamar.
    assert llm.llamadas == []

    conv = conversation_crud.listar_conversaciones(db, usuario="local")[0]
    mensajes = conversation_crud.obtener_ultimos_mensajes(db, conv.id)
    assert [m.rol for m in mensajes] == ["user"]
```

Y al **final** de `backend/tests/api/test_query.py`:

```python
def test_el_contrato_de_preguntar_documenta_el_evento_paso(client):
    esquemas = client.get("/openapi.json").json()["components"]["schemas"]

    assert "EventoPaso" in esquemas
    assert esquemas["EventoPaso"]["properties"]["tipo"]["const"] == "paso"
    variantes = esquemas["EventoStream"]["oneOf"]
    assert {"$ref": "#/components/schemas/EventoPaso"} in variantes
```

```bash
uv run pytest -q tests/integration/test_query_service.py tests/api/test_query.py
# esperado: 2 failed, 12 passed
```

El primero tiene que fallar con `RuntimeError: el proveedor devolvio 429`: la excepción escapa del generador, que es lo mismo que viste con `curl` en `falla_grafo`, ahora reproducido en 0,2 s. El segundo, con `AssertionError: assert 'EventoPaso' in {...}`. Pega el resumen.

### Paso 4 — El arreglo (10 min)

**a) `backend/app/services/query_service.py`.** Dentro de `generar()`, envuelve el bucle del grafo en un `try`. Sustituye desde `estado: dict = {}` hasta la línea anterior a `yield from responder_stream(` por:

```python
        estado: dict = {}
        marca = time.perf_counter()
        try:
            for tramo in grafo.stream(entrada, stream_mode="updates"):
                for nodo, actualizacion in tramo.items():
                    ahora = time.perf_counter()
                    actualizacion = actualizacion or {}
                    # El estado completo se rehace a mano porque `updates` solo
                    # trae lo que cambio. Solo hacen falta dos claves, y cada una
                    # la escribe un unico nodo, asi que gana la ultima.
                    for clave in ("chunks", "messages"):
                        if clave in actualizacion:
                            estado[clave] = actualizacion[clave]

                    yield traductor_evento(
                        "paso",
                        {
                            "nodo": nodo,
                            "ms": round((ahora - marca) * 1000),
                            **datos_del_paso(nodo, actualizacion),
                        },
                    )
                    marca = ahora
        except Exception as e:
            # Tres nodos llaman al LLM (reformular, multiconsulta, reescribir) y
            # cualquiera puede fallar con el stream ya abierto. Sin esto la
            # excepcion corta la conexion a medias y el cliente no sabe por que.
            yield traductor_evento("error", {"mensaje": str(e)})
            return

```

Por qué `except Exception` y no un `except:` a secas: cuando el cliente se desconecta, Python cierra el generador lanzando `GeneratorExit` en el `yield` donde estaba parado. `GeneratorExit` hereda de `BaseException`, no de `Exception`, así que este `except` no lo captura y el generador se cierra como debe. Con un `except:` a secas lo capturarías, harías otro `yield` y Python respondería con `RuntimeError: generator ignored GeneratorExit`.

**b) `backend/app/api/schemas.py`.** Añade este modelo justo **antes** de `class EventoFuentes(BaseModel):`:

```python
class EventoPaso(BaseModel):
    """Un nodo del grafo acaba de terminar. Llegan entre 'inicio' y 'fuentes',
    uno por nodo; las ramas paralelas de 'buscar' emiten uno cada una. Lleva
    hechos, no frases: cada nodo rellena solo sus cifras y el resto no viaja."""

    tipo: Literal["paso"]
    nodo: str = Field(examples=["buscar"])
    ms: int = Field(description="Milisegundos desde el evento anterior, no lo que tardo el nodo.")
    subconsultas: int | None = Field(default=None, description="Solo en 'multiconsulta'.")
    fragmentos: int | None = Field(default=None, description="Solo en 'buscar' y 'fusionar'.")
    score: float | None = Field(default=None, description="Solo en 'evaluar': el mejor logit del reranker.")
    pobre: bool | None = Field(default=None, description="Solo en 'evaluar'.")
    intento: int | None = Field(default=None, description="Solo en 'reescribir'.")
```

Y en `EventoSSE`, añade `EventoPaso` a la unión:

```python
EventoSSE = Annotated[
    EventoInicio | EventoPaso | EventoFuentes | EventoTexto | EventoError | EventoFin,
    Field(discriminator="tipo"),
]
```

**c) `backend/app/api/routers/query.py`.** En la `description` de `/preguntar`, cambia el orden garantizado para que incluya `paso`. Por ejemplo: ``"Orden garantizado: `inicio`, N x `paso` (uno por nodo del grafo), `fuentes`, N x `texto` y, para cerrar, `fin` (exito) o `error`. "`` y añade `EventoPaso` a la lista de modelos de la frase anterior. Termina la frase del 200 diciendo que el `error` puede llegar también **durante los pasos** si falla el grafo.

```bash
uv run pytest -q tests/integration/test_query_service.py tests/api/test_query.py   # 14 passed
```

### Paso 5 — El mismo corte, ahora con evento (4 min)

Reinicia el servidor de demostración con `MODO=falla_grafo` (no tiene `--reload`, así que hay que pararlo y volver a lanzarlo para que cargue tu código) y repite:

```bash
curl -sN -X POST localhost:8001/preguntar -H 'Content-Type: application/json' -d "$PREGUNTA"; echo "curl salió con $?"
```

Esperado: `inicio`, `paso reformular`, `{"tipo": "error", "mensaje": "litellm.RateLimitError: 429 en multiconsulta"}` y `curl salió con 0`. Pega el antes y el después, uno al lado del otro.

Opcional: abre `http://localhost:8001/docs`, despliega `POST /preguntar` → *Schemas* y comprueba que aparece `EventoPaso`.

### Paso 6 — Validar y subir (3 min)

```bash
cd ~/ruta/AGENT4U/backend
uv run pytest -q                  # 93 passed (91 + 2)
uv run ruff check app tests       # All checks passed!
cd ..
git add backend/app/services/query_service.py backend/app/api/schemas.py backend/app/api/routers/query.py \
        backend/tests/integration/test_query_service.py backend/tests/api/test_query.py
git diff --cached --stat          # 5 ficheros
git commit -m "fix(preguntar): un fallo del grafo llega como evento error; paso en el contrato SSE"
git push -u origin ejercicio/dia-09
```

### Preguntas (responde con tus palabras en la entrega)

1. ¿Qué hace `-N` en `curl`? Explícalo con tus dos mediciones del Paso 2. ¿Qué pieza de AGENT4U hace el mismo papel que `-N` en producción y qué pasaría sin ella?
2. Recorre el orden de los eventos y di, para cada tipo, qué fichero y qué línea lo emiten. ¿Por qué `inicio` sale antes de ejecutar el grafo y no al final?
3. ¿Por qué el modelo `gpt-5` devuelve un 422 de verdad y un 429 de Gemini no puede devolverlo? ¿Qué tiene que ver con que `responder` **devuelva** un generador en vez de **ser** un generador?
4. ¿Por qué el `except` de tu arreglo es `except Exception` y no `except:`? ¿Qué pasaría cuando el usuario cierra la pestaña?
5. Si en la UI eliges `gemini/gemini-flash-latest`, ¿qué modelo usa cada una de las 4 llamadas al LLM? Di dónde se decide cada uno. ¿Te parece bien? ¿Lo dejarías así, lo harías explícito o lo cambiarías?
6. Tras `falla_grafo`, ¿qué queda en la BD y qué mensajes recibe el LLM en la siguiente pregunta de ese hilo? Propón un arreglo concreto (qué fichero, qué cambio) y di qué pierdes con él.
7. Con FastAPI 0.139.2, ¿cuándo se cierra la sesión que inyecta `get_db` en `/preguntar`? ¿Qué dice el docstring de `responder` y por qué ya no es verdad? ¿Usarías `scope="function"` o arreglarías el comentario?
8. En tu caso `MODO=ok` cortado a 1,2 s, ¿cuántos trozos más pidió el servidor al LLM tras el corte? ¿Por qué no se guarda la respuesta parcial? ¿Qué línea de `streaming.py` no llega a ejecutarse?

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-09` en el remoto, creada desde `main` (`git merge-base --is-ancestor origin/main origin/ejercicio/dia-09`).
- [ ] Paso 2: traza con tiempos **con los 6 tipos de evento etiquetados** (fichero y línea), cabeceras, la medición sin `-N`, el 422 y el 404, el código de salida de `curl` en los tres modos, las líneas `[llm] trozo` del corte y la salida de la BD.
- [ ] Paso 3: resumen de pytest con `2 failed, 12 passed` **antes** de tocar el código, con los dos mensajes de error.
- [ ] Paso 5: el antes (`curl` sale con 18) y el después (evento `error`, sale con 0).
- [ ] `uv run pytest -q` → `93 passed` y `uv run ruff check app tests` limpio (pega los resúmenes).
- [ ] `git diff --stat origin/main origin/ejercicio/dia-09` muestra solo los 5 ficheros del Paso 6.
- [ ] Las 8 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

Entrega (antes de las 8:30 del **sábado 7-nov**):

```bash
git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-09.md
# ...rellena dia-09.md: trazas, códigos de salida, BD, resúmenes de pytest y ruff, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-09.md
git commit -m "entrega día 09" && git push
```

Si quieres feedback antes de entregar, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code con `XX = 09`, estando en tu rama `ejercicio/dia-09`.

**Si quieres verlo con Gemini de verdad** (opcional, necesitas Qdrant con documentos indexados, modelos en caché y clave): arranca la API normal con `export GEMINI_API_KEY=tu_clave` además de `APP_GEMINI_API_KEY` (por el 🔴 del día 02) y lanza la misma pregunta con `curl -sN … localhost:8000/preguntar`. Fíjate en el tamaño de los trozos `texto`: Gemini no manda una palabra por evento, sino varias.

---

## 5. Para profundizar (opcional)

- MDN, *Using server-sent events* (formato del stream, los campos `event`, `id` y `retry`, y por qué `EventSource` solo hace GET): https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- FastAPI, *Dependencies with yield* (cuándo se ejecuta el código de salida con un `StreamingResponse` y el parámetro `scope`): https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la sección *7. Generación y streaming* debería cubrir:

- El recorrido: el router valida (422/404) **antes** de abrir el stream; `responder` hace el trabajo de BD y devuelve un generador; los 6 eventos, en orden, y quién emite cada uno.
- La trampa del 200: por qué un fallo a mitad solo puede llegar como evento `error`, y que ahora (tras tu arreglo) también lo hace un fallo del grafo.
- Las 4 llamadas al LLM: cuándo se hace cada una, cuál va en streaming, qué modelo usa cada una y dónde se decide.
- El prompt de la respuesta: system, historial y un `user` con contexto numerado y la pregunta **original**; sin citas en el texto porque las fuentes van aparte.
- La persistencia: la pregunta siempre y la respuesta solo si termina bien, con el hueco de las preguntas huérfanas.
- El camino hasta el navegador: el gateway reenvía bytes, nginx sin búfer y el parser del frontend que guarda el trozo incompleto.
- Los huecos abiertos: la clave que no llega a LiteLLM, sin timeouts ni reintentos, la inyección de prompt indirecta y el README desactualizado.

**El sábado 7-nov (día 10, sesión larga):** la persistencia con SQLAlchemy. `db/session.py` (el motor, `expire_on_commit=False` y el WAL de SQLite), los modelos `Conversacion`, `Mensaje` y `Documento`, el CRUD y los ids de cinco cifras (de ahí sale el `conversacion_id: 62473` de hoy). Retomaremos las preguntas huérfanas y los objetos ORM que viajan dentro del estado del grafo, y relacionarás las tablas de SQLite con lo que ves en la UI.
