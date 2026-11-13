# Píldora 13 — Cliente de API: GraphQL, SSE y errores

**Viernes 13-nov-2026 · 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 12

No hay entrega del día 12: en `origin/aprendizaje` no existe `entregas/dia-12.md` y en el remoto no hay ninguna rama `ejercicio/dia-*`. Tampoco ha llegado tarde ninguna de las anteriores. Sin nota.

**`main` se ha movido.** Desde la píldora 12 han entrado cinco PR (11 y 12-nov): `#39` (saneamiento de la config de modelos), `#40` (errores del stream y la pregunta de la portada), `#41` (identidad de documento en Qdrant), `#42` y `#43` (Docker y migraciones con Alembic). Hoy está en `0b07f02`. Dos de ellas tocan de lleno el tema de hoy y las uso abajo: `#40` cambió `useConversacion.ts` y `estado.ts`, y `#41` añadió un campo a las fuentes del SSE. El ejercicio del día 12 sigue valiendo tal cual: `src/app/Raiz.tsx` no ha cambiado.

Lo que cuento lo he comprobado hoy contra `0b07f02`: `npx vitest run` da **11 ficheros, 90 tests** en verde (dos más que el miércoles, los de `#40`). He hecho el ejercicio entero en el navegador antes de escribirlo, y las salidas que pego son reales.

---

## 1. Concepto clave: tres maneras de que un fallo llegue al navegador

### 1.1 `fetch` solo rechaza cuando no hay respuesta

`fetch()` devuelve una promesa que **se resuelve con cualquier respuesta HTTP**, también un 404 o un 500. Solo **rechaza** (lanza) cuando no hay respuesta que leer:

- No hay conexión, falla el DNS o el servidor no escucha.
- **CORS lo bloquea.** El servidor sí respondió, pero el navegador no deja que tu JavaScript lo lea, y para tu código es lo mismo que si no hubiera respondido: `TypeError: Failed to fetch`.
- Se aborta con un `AbortSignal` (`AbortError`, o `TimeoutError` si es `AbortSignal.timeout`).

Por eso todo cliente serio tiene **dos ramas**: el `catch` del `fetch` (no hubo respuesta) y el `if (!respuesta.ok)` (hubo respuesta, pero de error).

### 1.2 GraphQL: el error viaja dentro de un 200

Una petición GraphQL que falla en un resolver responde **HTTP 200** con este cuerpo:

```json
{ "data": null, "errors": [{ "message": "...", "path": ["salud"], "extensions": { ... } }] }
```

El código HTTP solo dice si el servidor GraphQL pudo procesar la petición, no si tu consulta salió bien. La información del fallo va en `errors[]`, y `extensions` es un hueco libre para que el servidor añada datos estructurados, como el código HTTP original del backend.

### 1.3 SSE por `fetch`: el error viaja dentro del stream, o en ningún sitio

Un stream SSE es una respuesta HTTP normal con `Content-Type: text/event-stream` cuyo cuerpo no termina hasta que el servidor cierra. Cada evento es un bloque de líneas acabado en una **línea en blanco**:

```text
data: {"tipo":"inicio","conversacion_id":4242}

data: {"tipo":"texto","texto":"Primer "}

```

Una vez enviada la cabecera `200`, el servidor ya no puede cambiar el código. Así que un fallo a mitad solo puede llegar de dos formas:

- **Como evento**, si el servidor lo captura: `data: {"tipo":"error",...}`.
- **Como un corte de la conexión**, si no. Entonces es `reader.read()` el que lanza, mucho después de que `fetch()` se resolviera bien.

**Por qué `fetch` + `ReadableStream` y no `EventSource`.** El navegador trae `EventSource`, que parsea SSE solo y se reconecta solo. No sirve aquí por tres motivos:

1. **Solo hace GET.** `/preguntar` es un POST con un cuerpo JSON (la pregunta, el hilo, el modelo). Con GET habría que meter la pregunta en la URL, con su límite de longitud y apareciendo en los logs de nginx.
2. **No admite cabeceras propias** ni un `AbortSignal`. Para cortarlo hay que llamar a `.close()`, sin integrarse con el resto del cliente.
3. **Se reconecta solo.** Si la conexión se cae, vuelve a pedir la URL. En un stream que **crea** un mensaje en la base de datos, reconectar equivale a volver a preguntar: un efecto secundario no deseado.

El coste de leer el SSE "a mano" es que el parseo, el troceado y los errores de lectura pasan a ser tuyos. Hoy vas a encontrar un hueco justo ahí.

### 1.4 Un trozo de red no es un evento

`reader.read()` devuelve lo que haya llegado por TCP: puede ser medio evento, tres eventos o un evento y medio. Incluso puede cortar **un carácter UTF-8 por la mitad** (la `ñ` son dos bytes: `0xC3 0xB1`). Hay dos capas que lo resuelven:

- **`TextDecoderStream`** convierte bytes en texto y **retiene** los bytes de un carácter incompleto hasta que llega el resto.
- **Un `buffer` propio** acumula texto, corta por `\n\n` y guarda el último trozo, que puede estar incompleto, para la vuelta siguiente.

---

## 2. Cómo está en AGENT4U

### 2.1 El mapa de `shared/api/`

```text
src/shared/api/
├── cliente.ts         149 l.  peticionCruda / peticion: URL base, límite de tiempo, traducción de fallos a ErrorApi
├── errores.ts          51     ErrorApi, TipoErrorApi (5 tipos), MENSAJES, mensajeDeError
├── graphql.ts          44     graphql<T>(): POST /graphql y errors[] → ErrorApi
├── preguntar.ts       100     preguntar(): POST /preguntar leyendo el SSE a mano
├── types.ts           161     espejo de backend/app/api/schemas.py (Fuente, EventoSSE...)
├── conversaciones.ts   99  ┐
├── documentos.ts      168  │  una función por operación, todas sobre graphql()
├── salud.ts            73  │  (salvo la subida de ficheros, que va por peticionCruda)
└── ajustes.ts          28  ┘
```

Hay tres capas: **`cliente.ts` es el único sitio que llama a `fetch`**. Encima, `graphql.ts` y `preguntar.ts` hablan cada uno su protocolo, y encima de ellos los módulos de dominio. Ningún componente de React llama a `fetch` directamente.

### 2.2 `cliente.ts`: dónde se decide qué tipo de fallo es

```ts
// src/shared/api/cliente.ts:62-106 (resumido)
export async function peticionCruda(ruta, opciones = {}) {
  const { metodo = 'GET', cuerpo, signal, tiempoLimiteMs = TIEMPO_LIMITE_MS } = opciones;
  const { signal: senal } = combinarSenales(signal, tiempoLimiteMs);  // externa + 15 s

  const url = urlDe(ruta);            // FUERA del try: 'configuracion' no debe disfrazarse de 'red'

  let respuesta: Response;
  try {
    respuesta = await fetch(url, { method: metodo, signal: senal, headers, body });
  } catch (error) {
    if (signal?.aborted) throw error;                                   // cancelación pedida: no es fallo
    if (error instanceof DOMException && error.name === 'TimeoutError')
      throw new ErrorApi(MENSAJES.tiempo, 'tiempo');
    throw new ErrorApi(MENSAJES.red, 'red');                            // sin respuesta (o CORS)
  }

  if (!respuesta.ok) {
    throw new ErrorApi(await mensajeHttp(respuesta), 'http', respuesta.status);
  }
  return respuesta;
}
```

Fíjate en tres detalles finos:

- **`signal?.aborted` mira la señal de quien llama, no la combinada.** Si salta el temporizador, la combinada está abortada pero la externa no, y por eso cae en `'tiempo'`. Si el usuario pulsa *Detener*, la externa está abortada y el `AbortError` sube intacto para que el llamante lo ignore.
- **`mensajeHttp` (líneas 130-149)** usa el `detail` del backend solo en los 4xx, porque está escrito para el usuario (`"Conversación no encontrada"`). En los 5xx lo sustituye por `"El servidor ha fallado al procesar la petición (500)."`.
- **Un `FormData` va sin `Content-Type`** (líneas 77-91), para que el navegador ponga el `boundary` del multipart.

### 2.3 `graphql.ts`: convertir `errors[]` en una excepción

```ts
// src/shared/api/graphql.ts:23-44 (resumido)
const respuesta = await peticion<RespuestaGraphQL<T>>('/graphql', { ...opciones, metodo: 'POST', cuerpo });
const [error] = respuesta.errors ?? [];
if (error) throw new ErrorApi(error.message, 'http', error.extensions?.status);
if (respuesta.data == null) throw new ErrorApi(MENSAJES.respuesta, 'respuesta');
return respuesta.data;
```

La pareja de esto está en el gateway: `gateway/app/schema/mutations.py:15` traduce un `BackendHttpError` (los 409 y 429 del backend) a `GraphQLError(..., extensions={"status": e.status})`. Así el `409 ya existe` del día 05 llega a `useIngesta.ts:127` como `error.estado === 409`, aunque por HTTP haya viajado un 200. **Solo el primer error** se convierte en excepción: con un único campo raíz por consulta no se pierde nada, pero con varios campos fallando a la vez sí.

### 2.4 `preguntar.ts`: el SSE leído a mano

```ts
// src/shared/api/preguntar.ts:59-100 (resumido)
export async function* preguntar(cuerpo, opciones = {}) {
  const respuesta = await peticionCruda('/preguntar', {
    metodo: 'POST', cuerpo, signal: opciones.signal,
    tiempoLimiteMs: 0,                         // sin límite: una respuesta larga tarda lo que tarda
  });
  if (!respuesta.body) throw new ErrorApi(MENSAJES.respuesta, 'respuesta', respuesta.status);

  const lector = respuesta.body.pipeThrough(new TextDecoderStream()).getReader();   // §1.4
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await lector.read();      // ← línea 79: aquí puede lanzar un corte
      if (done) break;
      buffer += value;
      const bloques = buffer.split('\n\n');
      buffer = bloques.pop() ?? '';                      // el último puede estar a medias
      for (const bloque of bloques) {
        const evento = parsearEventoSSE(bloque);
        if (evento) yield evento;
      }
    }
    const ultimo = parsearEventoSSE(buffer);
    if (ultimo) yield ultimo;
  } finally {
    await lector.cancel().catch(() => undefined);      // si el consumidor sale del for-await, se suelta la conexión
  }
}
```

Es un **generador asíncrono** (`async function*`): quien lo consume escribe `for await (const evento of preguntar(...))` y recibe los eventos según llegan, sin callbacks. El `finally` se ejecuta también si el consumidor hace `break` o lanza, y eso cierra el stream.

`parsearEventoSSE` (líneas 31-46) es pura: coge la primera línea `data:`, hace `JSON.parse` y comprueba el `tipo` contra una **lista blanca** (`TIPOS`, línea 17). Un bloque corrupto o un tipo desconocido devuelve `null` en lugar de lanzar. `preguntar.test.ts:37-48` documenta por qué importa: cuando el backend añadió el evento `paso`, nadie tocó la lista blanca, y los pasos se descartaban en silencio.

### 2.5 `useConversacion.ts`: de *Enviar* al primer token

El recorrido completo, con las líneas reales:

1. **`Composer.tsx:40-42`**: `enviar()` llama a `onEnviar(texto)`, que es el `enviar` de `useConversacion`, pasado por `App.tsx:40` → `PanelChat.tsx:127`.
2. **`useConversacion.ts:83-95`**: si ya hay un `control.current` (un stream en vuelo) no hace nada. Si no, crea un `AbortController` y despacha `{ tipo: 'enviar' }` con **dos UUID generados en el cliente**. El reducer (`estado.ts:97-120`) añade a la vez el mensaje del usuario y uno del agente **vacío** en fase `'escribiendo'`. La UI pinta la burbuja antes de que salga la petición.
3. **`useConversacion.ts:97-111`**: una IIFE `async` lanza `preguntar()`. Los ajustes se leen de una ref (`ajustesVigentes`) para que `enviar` no cambie de identidad cada vez que tocas el panel.
4. **`useConversacion.ts:113-145`**: el `for await` traduce cada evento SSE a una acción del reducer. `inicio` guarda el id del hilo **en el acto** en `localStorage` (el comentario de las líneas 117-122 explica el hueco de un fotograma que cazó una e2e). `paso` alimenta la línea de tiempo. `texto` concatena (`estado.ts:138`).
5. **Primer token visible**: `Mensaje.tsx:49` pasa de `trabajando` (sin contenido) a pintar `<Respuesta texto=…>`, que convierte el markdown a HTML con `useMemo` en cada cambio de texto (eso es el día 14).
6. **Cierre**: `fin` o `error` marcan `terminado`. Si el stream acaba **sin** evento terminal, la línea 149 despacha `fin` igualmente para que `enviando` no se quede en `true`. Cualquier excepción va al `catch` (150-152): `detener` si la cancelaste tú, `errorTransporte` con `mensajeDeError(error)` en cualquier otro caso.

**Dos errores, dos sitios.** `errorModelo` (el evento `error` del SSE) va **en el mensaje** (`motivoError`), porque el hilo sigue vivo y el texto parcial vale. `errorTransporte` va en el **estado global** (`estado.error`), con el botón *Reintentar*.

### 2.6 Lo que trajo `#40`

- **Reintentar ya no duplica** (`estado.ts:79-88`, `sinTurnoFallido`): si el último turno es esta misma pregunta y falló, se sustituye. El backend aplica la misma regla en `query_service.py:95-100`, de modo que pantalla y SQLite cuentan lo mismo.
- **Un fallo de un nodo del grafo sale como evento `error`** (`query_service.py:114-123`). Antes cortaba la conexión. El comentario lo dice tal cual: "el cliente solo veía un error de red". Es decir, el backend reconoció el problema del corte a mitad y lo tapó **en su lado**. En el cliente sigue abierto (§3, 🔴).
- **La pregunta de la portada viaja en `?q=`** (`routes.ts:26-34`, `useConversacion.ts:235-256`). El envío va en un `setTimeout(…, 0)` que el *cleanup* cancela. En desarrollo, `StrictMode` monta, desmonta y vuelve a montar: el primer envío se cancela antes de salir y solo vale el segundo. Es un patrón que conviene reconocer: **un efecto con efectos secundarios no idempotentes se protege aplazándolo y cancelándolo en el cleanup**.

---

## 3. Por qué se montó así

**Un único `fetch` en todo el frontend.** Centralizarlo en `peticionCruda` hace que la URL base, el límite de tiempo, la cancelación y la clasificación de errores se escriban una vez. La alternativa habitual es una librería (`axios`, `ky`), o TanStack Query para la caché y los reintentos. Para nueve módulos de API, 150 líneas propias sin dependencias son razonables. El coste es que todo lo que esas librerías dan gratis (reintentos con *backoff*, deduplicación, caché) aquí no existe.

**Errores con tipo (`TipoErrorApi`) en lugar de cadenas.** La idea es buena: `'configuracion'` no se arregla reintentando y `'red'` sí, así que la UI debería reaccionar distinto. El coste aparece si nadie lee el tipo… y eso es justo lo que pasa (ver abajo).

**Un generador para el stream.** `async function*` separa limpiamente transporte y estado: `preguntar.ts` no sabe nada de React y `useConversacion` no sabe nada de bytes. La alternativa (callbacks `onEvento`, `onError`, `onFin`) obliga a cablear la cancelación a mano. Con el generador, salir del `for await` ya cancela.

**El reducer puro como sitio de la lógica.** `estado.ts:90-93` lo dice: "toda la lógica del chat vive aquí para poder probarla sin React, que es donde está el riesgo real: el orden de los eventos". Por eso hay 179 líneas de test sobre `estado.ts` y ninguno sobre `useConversacion`. El coste es que lo que vive en el hook (el `catch`, el `terminado`, la cancelación) **no lo prueba ningún test unitario**. Solo lo cubren las e2e del camino feliz.

### La promesa del día 11: ¿por qué no llega `MENSAJES.red` cuando el backend cae?

Lo he comprobado con el gateway real (`uv run uvicorn app.main:app --port 8080`) apuntando a un backend que no existe:

```text
$ curl -si -X POST -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' \
    -d '{"query":"hola"}' localhost:8080/preguntar
HTTP/1.1 500 Internal Server Error
content-type: text/plain; charset=utf-8

Internal Server Error
```

`gateway/app/proxy.py:21` hace `await client.send(...)` sin `try`. El `httpx.ConnectError` sube sin capturar, y Starlette lo convierte en un 500 en su middleware más externo (`ServerErrorMiddleware`), que está **por fuera** del `CORSMiddleware`. Resultado: **un 500 sin `access-control-allow-origin`**. Lo que ve el usuario depende de dónde corra:

| Dónde | Qué pasa en el navegador | Mensaje en pantalla |
|---|---|---|
| Desarrollo (`:5173` → `:8080`, origen cruzado) | CORS bloquea la respuesta y `fetch` rechaza | `MENSAJES.red`: "¿Está arrancado el backend?" (acierta **por casualidad**) |
| Producción (nginx, mismo origen) | El 500 se lee y `mensajeHttp` lo trata como 5xx | "El servidor ha fallado al procesar la petición (500)." |

En cambio, por GraphQL el mismo fallo es un **200** con `errors: [{"message": "All connection attempts failed"}]` (también comprobado), sin `extensions.status`. `graphql.ts` lo convierte en un `ErrorApi('All connection attempts failed', 'http')`, y ese texto de `httpx` es el que sale en la lista de documentos. `comprobarSalud()` se salva porque se traga cualquier error y devuelve `'caido'`.

**Conclusión:** el frontend clasifica bien lo que recibe, pero el gateway no le da la información para hacerlo. El arreglo de verdad está en el gateway: capturar `httpx.ConnectError` y `httpx.TimeoutException` en el proxy y responder `502`/`504` con `{"detail": ...}`, y en GraphQL añadir un `extensions: {"status": 502}`.

### Cosas que no cuadran

- 🔴 **Un corte a mitad del stream sale como `network error`.** `preguntar.ts:79` (`await lector.read()`) está fuera de cualquier `try` que traduzca errores. Si el gateway, nginx o la red cortan con el 200 ya enviado, el `TypeError` del navegador sube crudo. `mensajeDeError` (`errores.ts:47-51`) devuelve su `.message` y el usuario lee **"network error"** en inglés junto a *Reintentar*. Lo he reproducido en Chromium (salida en el ejercicio). El propio `estado.test.ts:73` usa `'network error'` como mensaje de ejemplo. Lo arreglas hoy.
- 🟠 **Nadie lee `ErrorApi.tipo`.** `grep` en `src/` (sin tests): `tipo` solo se escribe. La UI usa el mensaje y, en `useIngesta.ts:127,153`, el `estado`. Un error `'configuracion'` (bundle mal construido) ofrece *Reintentar*, que nunca va a funcionar. La clasificación existe, pero no cambia el comportamiento.
- 🟠 **El gateway rompe con cuerpos de error que no son JSON.** `proxy.py:25` hace `resp.json()` sobre cualquier no-200. Si el backend responde un 500 en texto plano, el `json()` lanza y el gateway devuelve **su propio** 500 sin CORS, con el mismo efecto de la tabla de arriba.
- 🟡 **Comentarios desactualizados.** `preguntar.ts:51` dice "Orden garantizado: `inicio`, `fuentes`, N x `texto`…" y le falta `paso`, que `types.ts:131` sí recoge. `cliente.ts:8-10` sigue diciendo "nginx proxea **al backend**" y que el `.env` traía `localhost:8000` (hoy es `:8080`, el gateway). `MENSAJES.red` manda a mirar "el backend" cuando el frontend habla con el gateway.
- 🟡 **`combinarSenales` devuelve un `limpiar` que no hace nada** (`cliente.ts:43-53`) y nadie lo llama (`cliente.ts:67` solo desestructura `signal`). Es código muerto de una versión que limpiaba un `setTimeout` a mano antes de `AbortSignal.timeout`.
- 🟡 **`types.ts` ya no es espejo exacto.** Desde `#41` cada fuente del SSE trae `documento_id` (`streaming.py:32`, `schemas.py:377`), pero `Fuente` en `types.ts:7-24` no lo declara. No rompe nada, porque TypeScript no valida en ejecución, pero el comentario de la línea 2 ("Espejo de `schemas.py`") ya no es verdad.
- 🟡 **El parser de SSE es mínimo.** Corta solo por `\n\n` y lee solo la **primera** línea `data:`. La especificación admite `\r\n` y eventos con varias líneas `data:` que se concatenan. Hoy funciona porque `streaming.py:10` siempre escribe `data: {json}\n\n` en una línea, pero si mañana se cambia a `sse-starlette` (que separa con `\r\n` por defecto), el stream se quedaría mudo sin un solo error.
- 🟡 **El texto del evento `error` es `str(e)` crudo** (`query_service.py:122`, `streaming.py:66`). El usuario puede leer un volcado de LiteLLM en inglés. El frontend lo pinta tal cual en `motivoError`.

---

## 4. Ejercicio (40 min)

Rama `ejercicio/dia-13` desde `main`. Objetivo: ver el stream a cámara lenta, medir cuándo llega cada evento, reproducir el 🔴 y arreglarlo **con el test primero**.

No necesitas backend ni gateway: usarás el **servidor falso** de las e2e y, delante, un gateway de mentira lento que escribes fuera del repo.

### Paso 1 — Rama e instalación (4 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-13 origin/main
cd frontend
npm ci
npx vitest run                # esperado: Test Files 11 passed · Tests 90 passed
```

### Paso 2 — Un gateway lento, fuera del repo (5 min)

El servidor falso lo escupe todo de golpe. Este script sirve `/preguntar` con pausas, **parte un evento en dos escrituras** y reenvía todo lo demás (GraphQL, preflight CORS) al servidor falso. Con `CORTAR=1`, corta la conexión a mitad.

```bash
mkdir -p /tmp/agent4u-front
cat > /tmp/agent4u-front/lento.mjs <<'EOF'
// Gateway de mentira LENTO para seguir el stream a cámara lenta.
// - POST /preguntar: lo sirve él, con pausas y con un evento partido en dos.
// - Todo lo demás (GraphQL, OPTIONS de CORS...): lo reenvía al servidor falso.
// Uso: node lento.mjs            → respuesta completa
//      CORTAR=1 node lento.mjs   → corta la conexión a mitad de la respuesta
import { createServer } from 'node:http';

const FALSO = 'http://localhost:8098';
const PAUSA_MS = Number(process.env.PAUSA_MS ?? 400);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sse = (d) => `data: ${JSON.stringify(d)}\n\n`;

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/preguntar') {
    for await (const _ of req); // se descarta el cuerpo
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Access-Control-Allow-Origin': '*',
    });
    const t0 = Date.now();
    const log = (m) => console.log(`+${String(Date.now() - t0).padStart(5)} ms  ${m}`);

    res.write(sse({ tipo: 'inicio', conversacion_id: 4242 }));
    log('inicio');
    for (const nodo of ['reformular', 'multiconsulta', 'buscar', 'fusionar', 'evaluar', 'construir']) {
      await espera(PAUSA_MS);
      res.write(sse({ tipo: 'paso', nodo, ms: PAUSA_MS }));
      log(`paso ${nodo}`);
    }
    await espera(PAUSA_MS);
    res.write(sse({ tipo: 'fuentes', fuentes: [] }));
    log('fuentes');

    // Un evento partido en dos escrituras: prueba el `buffer` de preguntar.ts.
    const primero = sse({ tipo: 'texto', texto: '## Respuesta lenta\n\nPrimer ' });
    res.write(primero.slice(0, 20));
    log(`texto (mitad 1: ${JSON.stringify(primero.slice(0, 20))})`);
    await espera(PAUSA_MS);
    res.write(primero.slice(20));
    log('texto (mitad 2) → PRIMER TOKEN completo');

    const trozos = ['token, ', 'segundo token, ', 'tercer token, ', 'y fin.'];
    for (const [i, texto] of trozos.entries()) {
      await espera(PAUSA_MS);
      if (process.env.CORTAR && i === 2) {
        log('CORTO LA CONEXIÓN sin evento final');
        return res.socket.destroy();
      }
      res.write(sse({ tipo: 'texto', texto }));
      log(`texto ${JSON.stringify(texto)}`);
    }
    res.end(sse({ tipo: 'fin' }));
    log('fin');
    return;
  }

  // Resto: proxy tonto al servidor falso.
  const cuerpo = [];
  for await (const c of req) cuerpo.push(c);
  const r = await fetch(FALSO + req.url, {
    method: req.method,
    headers: { ...req.headers, host: 'localhost:8098' },
    body: cuerpo.length ? Buffer.concat(cuerpo) : undefined,
  });
  const cabeceras = Object.fromEntries(r.headers);
  delete cabeceras['content-encoding']; // fetch ya lo ha descomprimido
  delete cabeceras['transfer-encoding'];
  res.writeHead(r.status, cabeceras);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8080, () => console.log('gateway lento en http://localhost:8080 → falso en :8098'));
EOF
```

Arranca las piezas, cada una en su terminal:

```bash
# Terminal 1 — servidor falso (el "backend")
cd frontend && node pruebas-e2e/servidor-falso.mjs 8098

# Terminal 2 — gateway lento
node /tmp/agent4u-front/lento.mjs
```

Y mira el stream crudo desde una tercera terminal:

```bash
curl -sN -X POST -H 'Content-Type: application/json' -d '{"query":"x"}' localhost:8080/preguntar
```

`-N` desactiva el búfer de `curl`: verás aparecer los eventos uno a uno. En la terminal 2 verás algo así, que es lo que yo obtuve:

```text
+    0 ms  inicio
+  401 ms  paso reformular
...
+ 2806 ms  fuentes
+ 2807 ms  texto (mitad 1: "data: {\"tipo\":\"texto")
+ 3208 ms  texto (mitad 2) → PRIMER TOKEN completo
```

### Paso 3 — Cronometra el recorrido en el navegador (8 min)

Instrumentación **temporal**: no se commitea. En `src/features/chat/useConversacion.ts`, dentro de `enviar`:

1. Justo **después** del `despachar({ tipo: 'enviar', ... })` (línea 95), añade:

```ts
    const t0 = performance.now();
    console.debug('[traza] +0 ms  enviar (burbujas pintadas en el siguiente render)');
```

2. Justo **dentro** del `for await (const evento of stream) {` (línea 113), como primera línea:

```ts
          console.debug(`[traza] +${Math.round(performance.now() - t0)} ms  ${evento.tipo}`);
```

Arranca Vite contra el gateway lento:

```bash
# Terminal 3
cd frontend
cp -n .env.example .env       # VITE_API_URL=http://localhost:8080
npm run dev
```

Abre `http://localhost:5173/app` con las DevTools abiertas (*Console*, nivel *Verbose* para ver `debug*`) y haz una pregunta. Copia la traza en la entrega. Fíjate en tres cosas:

- Entre `fuentes` y el primer `texto` hay unos 400 ms, no 0: es la mitad 1 esperando a la mitad 2 en el `buffer`. **Ningún evento sale a medias.**
- En la pestaña *Network*, la petición a `preguntar` **no** tiene pestaña *EventStream*. Chrome solo la enseña para `EventSource`; con `fetch` ves la respuesta cuando acaba.
- La línea de tiempo del agente ("6 pasos") se rellena **antes** del primer token: ese es el hueco que llenan los eventos `paso`.

Cuando acabes, **quita la instrumentación**:

```bash
git restore src/features/chat/useConversacion.ts
git status --short            # vacío (o solo .env, que está en .gitignore y no sale)
```

### Paso 4 — Reproduce el 🔴 (3 min)

Para el gateway lento (Ctrl+C en la terminal 2) y arráncalo en modo corte:

```bash
CORTAR=1 node /tmp/agent4u-front/lento.mjs
```

Vuelve a preguntar en `/app`. Verás "Primer token, segundo token," y, debajo, en la caja roja de error: **`network error`** (en Firefox, otro texto en inglés). Haz una captura o copia el texto.

### Paso 5 — Primero el test, en rojo (8 min)

Crea `src/shared/api/preguntar.stream.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EventoSSE } from '@/shared/api/types';

/**
 * `cliente.ts` lee VITE_API_URL al importarse, así que se fija la variable y se
 * vuelve a importar el módulo en cada prueba (igual que en cliente.test.ts).
 */
async function cargarPreguntar() {
  vi.stubEnv('VITE_API_URL', 'http://gateway.test');
  vi.resetModules();
  return import('@/shared/api/preguntar');
}

/** Un `Response` cuyo cuerpo llega en los trozos que se le pasan, tal cual. */
function respuestaEnTrozos(
  trozos: (string | Uint8Array)[],
  cortarCon?: unknown,
): Response {
  const cod = new TextEncoder();
  const pendientes = [...trozos];
  // `pull` y no `start`: el navegador entrega un trozo cada vez que se lee.
  // Además, `error()` vacía la cola, así que un corte metido en `start` se
  // comería los trozos anteriores y la prueba no simularía un corte "a mitad".
  const cuerpo = new ReadableStream<Uint8Array>({
    pull(controlador) {
      const t = pendientes.shift();
      if (t !== undefined) controlador.enqueue(typeof t === 'string' ? cod.encode(t) : t);
      else if (cortarCon !== undefined) controlador.error(cortarCon);
      else controlador.close();
    },
  });
  return new Response(cuerpo, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** Consume el generador y devuelve lo que llegó y, si lo hubo, el error final. */
async function consumir(
  gen: AsyncGenerator<EventoSSE>,
): Promise<{ eventos: EventoSSE[]; error: unknown }> {
  const eventos: EventoSSE[] = [];
  try {
    for await (const e of gen) eventos.push(e);
    return { eventos, error: null };
  } catch (error) {
    return { eventos, error };
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('preguntar() leyendo el stream', () => {
  it('reconstruye un evento partido entre dos trozos de red', async () => {
    const { preguntar } = await cargarPreguntar();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respuestaEnTrozos([
            'data: {"tipo":"tex',
            'to","texto":"Hola"}\n\ndata: {"tipo":"fin"}\n\n',
          ]),
        ),
    );

    const { eventos, error } = await consumir(preguntar({ query: 'x' }));

    expect(error).toBeNull();
    expect(eventos).toEqual([{ tipo: 'texto', texto: 'Hola' }, { tipo: 'fin' }]);
  });

  it('no rompe una ñ cuyos bytes llegan en trozos distintos', async () => {
    const { preguntar } = await cargarPreguntar();
    const bytes = new TextEncoder().encode('data: {"tipo":"texto","texto":"año"}\n\n');
    const corte = bytes.indexOf(0xc3) + 1; // entre los dos bytes de la ñ
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respuestaEnTrozos([bytes.slice(0, corte), bytes.slice(corte)]),
        ),
    );

    const { eventos } = await consumir(preguntar({ query: 'x' }));

    expect(eventos).toEqual([{ tipo: 'texto', texto: 'año' }]);
  });

  it('un corte de red a mitad llega como ErrorApi de tipo red', async () => {
    const { preguntar } = await cargarPreguntar();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respuestaEnTrozos(
            ['data: {"tipo":"inicio","conversacion_id":7}\n\n'],
            new TypeError('network error'),
          ),
        ),
    );

    const { eventos, error } = await consumir(preguntar({ query: 'x' }));

    expect(eventos).toEqual([{ tipo: 'inicio', conversacion_id: 7 }]);
    expect(error).toMatchObject({ name: 'ErrorApi', tipo: 'red' });
  });

  it('si cancela quien llama, se relanza el AbortError y no un ErrorApi', async () => {
    const { preguntar } = await cargarPreguntar();
    const control = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        const cuerpo = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(
              new TextEncoder().encode('data: {"tipo":"inicio","conversacion_id":7}\n\n'),
            );
            init.signal?.addEventListener('abort', () =>
              c.error(new DOMException('Cancelado', 'AbortError')),
            );
          },
        });
        return Promise.resolve(new Response(cuerpo, { status: 200 }));
      }),
    );

    const gen = preguntar({ query: 'x' }, { signal: control.signal });
    const primero = await gen.next();
    control.abort();
    const { error } = await consumir(gen);

    expect(primero.value).toEqual({ tipo: 'inicio', conversacion_id: 7 });
    expect(error).toMatchObject({ name: 'AbortError' });
  });
});
```

Ejecútalo:

```bash
npx vitest run src/shared/api/preguntar.stream.test.ts
```

Esperado: **3 en verde y 1 en rojo**, con este fallo:

```text
× un corte de red a mitad llega como ErrorApi de tipo red
AssertionError: expected TypeError: network error to match object { name: 'ErrorApi', tipo: 'red' }
```

Los tres verdes prueban que el `buffer` y `TextDecoderStream` ya hacen su trabajo. El rojo es el 🔴.

### Paso 6 — El arreglo (5 min)

En `src/shared/api/preguntar.ts`:

1. Justo **antes** del comentario `/* Lista blanca: ...` (línea 15), añade:

```ts
/** El texto que ya llego se conserva en pantalla; esto explica por que se paro. */
const STREAM_CORTADO =
  'Se ha perdido la conexión mientras llegaba la respuesta. Vuelve a intentarlo.';

```

2. Sustituye la línea `const { done, value } = await lector.read();` (la 79 original) por:

```ts
      let trozo: ReadableStreamReadResult<string>;
      try {
        trozo = await lector.read();
      } catch (error) {
        // Cancelado por quien llama: se relanza tal cual, igual que en cliente.ts.
        if (opciones.signal?.aborted) throw error;
        // La conexion se cayo con el 200 ya enviado: ningun try de cliente.ts
        // cubre este punto, y sin esto el usuario leeria "network error".
        throw new ErrorApi(STREAM_CORTADO, 'red');
      }
      const { done, value } = trozo;
```

(`ErrorApi` ya está importado en la línea 2.) Comprueba:

```bash
npx vitest run                # esperado: Test Files 12 passed · Tests 94 passed
npm run typecheck && echo TIPOS_OK
npm run lint
npx prettier --check src      # si se queja: npx prettier --write src/shared/api/
npx knip                      # sin salida = limpio (por eso STREAM_CORTADO no se exporta)
```

Vuelve al navegador, con el gateway lento todavía en `CORTAR=1`, y repite la pregunta (Vite recarga solo). Ahora la caja roja dice **"Se ha perdido la conexión mientras llegaba la respuesta. Vuelve a intentarlo."** y el texto parcial sigue encima. Pulsa *Reintentar* y observa que el turno fallido **se sustituye**, no se duplica (`sinTurnoFallido`, de `#40`).

### Paso 7 — Commit y push (2 min)

```bash
cd ~/ruta/AGENT4U
git add frontend/src/shared/api/preguntar.ts frontend/src/shared/api/preguntar.stream.test.ts
git status --short            # solo esos dos ficheros
git commit -m "fix(frontend): traducir el corte del stream de /preguntar a ErrorApi"
git push -u origin ejercicio/dia-13
```

### Preguntas (responde con tus palabras)

1. Enumera, con fichero y línea, los saltos desde que pulsas *Enviar* hasta que el primer token aparece en pantalla. ¿Por qué aparecen **dos** burbujas antes de que salga la petición? ¿Qué ganas generando los ids en el cliente con `crypto.randomUUID()`?
2. Explica con tu traza del Paso 3 por qué el primer `texto` tardó 400 ms más que `fuentes` aunque la primera mitad llegó al instante. ¿Qué línea de `preguntar.ts` lo retiene y qué pasaría sin ella? ¿Y qué hace `TextDecoderStream` que no haría `new TextDecoder().decode(value)` llamado a pelo en cada trozo?
3. Da **tres** razones por las que AGENT4U no usa `EventSource`. ¿Cuál de ellas sería peligrosa para los datos, y por qué?
4. Un mismo fallo (el backend caído) llega como `TypeError` en desarrollo, como un 500 en producción y como un 200 con `errors[]` por GraphQL. Explica cada caso. ¿Por qué el 500 del gateway no lleva cabeceras CORS? ¿Dónde pondrías el arreglo de verdad, y qué código HTTP devolverías?
5. En `cliente.ts:94`, ¿por qué se comprueba `signal?.aborted` (la señal del llamante) y no `senal.aborted` (la combinada)? ¿Qué se rompería si se cambiara?
6. Tu arreglo convierte el corte en `'red'`. ¿Alguien en la UI distingue hoy `'red'` de `'configuracion'`? Propón un cambio **concreto** (componente y condición) para que el tipo sirva de algo.
7. `useConversacion.ts:149` despacha `fin` si el stream acaba sin evento terminal. Con tu arreglo, un corte **lanza**, así que ya no llega ahí. ¿En qué caso se sigue ejecutando esa línea? ¿Es correcto pintar como "completo" una respuesta que terminó así?

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-13` creada desde `main` y subida, con un único commit que solo toca `frontend/src/shared/api/preguntar.ts` y `frontend/src/shared/api/preguntar.stream.test.ts`.
- [ ] La salida en **rojo** del Paso 5 pegada (3 passed, 1 failed, con el `TypeError: network error`).
- [ ] `npx vitest run` con 12 ficheros y 94 tests en verde; `npm run typecheck`, `npm run lint` y `npx prettier --check src` limpios.
- [ ] La salida de `curl -N` del Paso 2 y la traza de consola del Paso 3 pegadas, con los milisegundos de cada evento.
- [ ] El texto (o una captura) del error antes (`network error`) y después del arreglo.
- [ ] `useConversacion.ts` sin cambios en el commit (la instrumentación del Paso 3 no se sube).
- [ ] Las 7 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

**Bonus (opcional):** arregla el lado del gateway en un segundo commit. En `gateway/app/proxy.py`, envuelve el `client.send(...)` de `/preguntar` en un `try` que capture `httpx.ConnectError` → `HTTPException(502, "No se pudo conectar con el backend.")` y `httpx.TimeoutException` → `504`, y protege el `resp.json()` de la línea 25 para cuerpos que no son JSON. Comprueba con el `curl -si` de §3 que ahora sale un 502 **con** `access-control-allow-origin`, y añade el test en `gateway/tests/`.

Entrega antes de las **8:30 del domingo 15-nov**:

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-13.md
# ...rellena dia-13.md: salidas, traza, antes/después, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-13.md
git commit -m "entrega día 13" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code y te revisa la entrega y la rama al momento.

---

## 5. Para profundizar (opcional)

- MDN, *Using readable streams* (lectores, `pull`, `TextDecoderStream` y qué pasa con la cola al llamar a `error()`): <https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams>
- WHATWG HTML, formato de *Server-sent events* (separadores de línea, varias líneas `data:`, reconexión de `EventSource`): <https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream>

---

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la sección *11. Frontend: cliente de API y flujos* debería cubrir:

- Las tres capas de `shared/api/`: `cliente.ts` como único `fetch`, `graphql.ts` y `preguntar.ts` como protocolos, y los módulos de dominio encima.
- Cómo se clasifica un fallo (`configuracion`, `red`, `tiempo`, `http`, `respuesta`), en qué línea se decide cada uno y que hoy la UI solo usa el mensaje y el `estado`.
- Por qué `/preguntar` se lee con `fetch` + `ReadableStream` + `TextDecoderStream` + `buffer` y no con `EventSource`, y los dos sitios por los que llega un fallo a mitad (evento `error` frente a corte), con tu arreglo.
- El camino de *Enviar* al primer token: reducer puro con UUID del cliente, generador asíncrono y `for await`, y la regla de `sinTurnoFallido` compartida con el backend.
- El hueco del gateway: el backend caído sale como 500 sin CORS por `/preguntar` y como un `errors[]` con texto de `httpx` por GraphQL.

**El domingo 15-nov (día 14, sesión larga):** Markdown seguro. Cada token que acabas de seguir hoy vuelve a pasar por `markdownAHtml` (`marked` + `DOMPurify`) y se inyecta con `dangerouslySetInnerHTML`. Intentarás colar un XSS desde un documento indexado hasta la pantalla del chat, verás qué lo para y qué no, y mediremos cuánto cuesta reparsear la respuesta entera en cada token.
