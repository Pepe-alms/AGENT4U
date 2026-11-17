# Píldora 15 — Documentos y conversaciones en la UI: subida, sondeo y deduplicación

**Martes 17-nov-2026 · sesión corta: 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 14

No hay entrega del día 14: en `origin/aprendizaje` no existe `entregas/dia-14.md` y en el remoto no hay ninguna rama `ejercicio/dia-*`. Tampoco ha llegado tarde ninguna anterior. Sin nota.

El ejercicio del 14 (cerrar `class`, `data-*` y `//` en `markdownAHtml`) sigue valiendo tal cual: `#45` no ha tocado ni `markdown.ts` ni `Respuesta.tsx`. Lo he comprobado con `git diff 5b7620a origin/main` sobre esos dos ficheros, y sale vacío. Los tres agujeros siguen abiertos en `main`.

**`main` se ha vuelto a mover, y de lleno en el tema de hoy.** El 16-nov entró `#45` (*deduplicación*, `2cf91a8`): 71 ficheros y +3.507 líneas, con backend, gateway y frontend a la vez. Lo que afecta a hoy:

- **Tres niveles de duplicado.** Nivel 1: el mismo fichero (SHA-256 de los bytes, `409` antes de encolar). Nivel 2: el mismo texto en otro formato (huella del texto normalizado, estado `duplicado`). Nivel 3: casi igual (fragmentos compartidos ≥ `APP_UMBRAL_CASI_DUPLICADO`, estado `pendiente-decision`, a la espera de que el usuario decida).
- **`GET /trabajos/{id}` habla más.** Ahora devuelve `documento_id`, `relacionado` y los dos porcentajes.
- **El borrado va por id** y no por nombre.
- **El frontend tiene desenlaces nuevos.** `ingesta.ts` pasa de 4 a 8 fases, y llegan `DecisionPendiente.tsx` y `deduplicacion.ts`.

El plan decía "subida y sondeo". Hoy el sondeo tiene siete desenlaces posibles, así que la píldora sigue el código real.

Todo lo que cuento está comprobado hoy contra `2cf91a8`. `npx vitest run` da **14 ficheros y 117 tests**, y la suite del gateway, **66 tests**, todo en verde. He hecho el ejercicio entero en una copia limpia antes de escribirlo, y las salidas que pego son reales.

---

## 1. Concepto clave: estado del servidor en el cliente

### 1.1 Dos tipos de estado

En una app como esta, el frontend maneja dos clases de estado que se suelen mezclar:

- **Estado del cliente.** Solo existe en el navegador: qué pestaña está abierta, qué se está escribiendo o qué fila se está renombrando. Lo manda React y nadie más.
- **Estado del servidor.** Existe en SQLite y en Qdrant, y el navegador solo tiene **una copia que caduca**: la lista de documentos, el estado de una indexación o la lista de conversaciones. Mientras lo miras, puede cambiar sin que tú hagas nada, porque el worker termina un trabajo, otro usuario borra un documento o el reemplazo de un `pendiente-decision` borra el antiguo.

Con el segundo tipo siempre hay tres preguntas: **cuándo se pide, cuándo se da por caducado y cómo se entera la UI de que cambió**. Las librerías de *server state* (TanStack Query, SWR) existen para contestarlas con caché, revalidación, reintentos con espera creciente y deduplicación de peticiones. AGENT4U no usa ninguna: lo resuelve a mano con dos piezas, `useRecurso` (pedir una vez y reintentar a demanda) y `useIngesta` (sondear un trabajo hasta que acaba).

### 1.2 Sondeo (*polling*) frente a empuje (*push*)

Para saber cuándo termina un trabajo del worker hay dos opciones:

- **Push:** el servidor avisa, por SSE, WebSocket o un evento de Redis reenviado. Es inmediato, pero necesita una conexión abierta por cliente y que algo en el backend publique los cambios.
- **Polling:** el cliente pregunta cada X segundos. Es más tonto, pero no necesita infraestructura nueva y sobrevive a cortes de red sin hacer nada especial.

AGENT4U sondea. Lo hace con una **cadena de `setTimeout`**, no con `setInterval`: cada comprobación programa la siguiente **cuando la anterior ha terminado**. Con `setInterval`, si una petición tarda más que el intervalo, se te apilan peticiones en vuelo para el mismo trabajo.

### 1.3 Contratos que se rompen por añadir

En una API JSON, **añadir un campo** a una respuesta se considera un cambio compatible: el cliente que no lo conoce lo ignora. Esto solo es verdad si el cliente **ignora lo que no conoce**. Si el cliente reconstruye un objeto con `Clase(**json)`, un campo nuevo es un `TypeError`. Hoy lo vas a ver en el gateway.

---

## 2. Cómo está en AGENT4U

### 2.1 El mapa

```text
frontend/src/
  app/App.tsx                              monta todo: useRecurso(documentos), useRecurso(conversaciones), useIngesta
  shared/hooks/useRecurso.ts        48 l.  pedir una vez + reintentar (AbortController)
  shared/api/documentos.ts         222 l.  queries/mutations de documentos, subida REST, trabajo, resolver
  features/documentos/
    ingesta.ts                     182 l.  tipo Trabajo (8 fases), reducer puro, cupo (huecos, repartir)
    useIngesta.ts                  258 l.  lanzar, sondear, resolver y olvidar trabajos
    FormularioIngesta.tsx          365 l.  URL / fichero / ruta, filtros, cola visible con sus desenlaces
    ListaDocumentos.tsx            224 l.  lista (presentacional), borrar por id, duplicado y pendiente
    DecisionPendiente.tsx           65 l.  las tres acciones del nivel 3, ninguna por defecto
    deduplicacion.ts                41 l.  porcentajes y textos
  features/conversaciones/
    ListaConversaciones.tsx        219 l.  agrupada por fecha, renombrar y borrar
    TituloEditable.tsx              62 l.  Enter guarda, Escape cancela, perder el foco guarda
```

### 2.2 Quién pide qué: `App.tsx`

```tsx
// src/app/App.tsx:53-58
const { salud, comprobando } = useSalud();
const documentos = useRecurso(obtenerDocumentos);
// También la usa la paleta de comandos para buscar en el historial.
const conversaciones = useRecurso(obtenerConversaciones);
// Al terminar una ingesta se recarga la lista: el hook no la conoce, solo avisa.
const ingesta = useIngesta(documentos.reintentar);
```

Las listas se piden **una sola vez** en `App` y bajan por props. Hay tres consumidores de la lista de documentos: el panel, la bienvenida del chat (`hayDocumentos`) y la paleta. Si cada uno hiciera su propia petición, serían tres. `ListaDocumentos` y `ListaConversaciones` son **presentacionales en cuanto a la carga**: reciben un `EstadoRecurso<T>` y una función para recargar.

`useRecurso` (l. 10-11) modela el estado como **una unión discriminada**: `{fase:'cargando'} | {fase:'error'; mensaje} | {fase:'listo'; datos}`. Con varios booleanos (`cargando`, `error`, `datos`), "cargando y con error a la vez" sería representable. Con la unión, no. Cancela con `AbortController` al desmontar, y para recargar incrementa un contador `intento` que es dependencia del efecto (l. 37 y 42-45).

### 2.3 El recorrido de una subida

```text
FormularioIngesta.admitir()          extensión → tamaño (50 MB) → cupo (repartir)          FormularioIngesta.tsx:71-101
  └─ ingesta.subir(caben)            despachar {encolar}; fase 'en-cola'                      useIngesta.ts
       └─ subirFichero(f)            POST /indexar-fichero (REST multipart, proxy del gateway) documentos.ts:153
            ├─ 409 'mismo-fichero' → rechazarOFallar → fase 'rechazado' (+ relacionado)     useIngesta.ts:144
            ├─ otro error          → fase 'error' con mensajeDeIngesta(estado)
            └─ 202 {job_id}        → pollear(id, job_id)
                 └─ cada 500 ms la 1.ª vez, luego cada 5 s:                                   useIngesta.ts:27-28
                    query trabajo(job_id) → gateway → GET /trabajos/{job_id} → fila de SQLite
                      'indexando'          → fase 'indexando' y sigue
                      'indexado'           → fase 'hecho' (+ fragmentos), alTerminar()
                      'error'              → fase 'error' (+ error_message)
                      'duplicado'          → fase 'duplicado' (+ relacionado), alTerminar()
                      'pendiente-decision' → fase 'pendiente' (+ %), alTerminar()
                      excepción           → se ignora y se reintenta en 5 s                     useIngesta.ts:135-138
```

Fíjate en un detalle del backend (`backend/app/api/routers/jobs.py:24`): el estado del trabajo **no se pregunta a ARQ ni a Redis**. Se lee de la fila de `documents` por `job_id`. Quien mantiene el estado es el worker, al marcar `indexando`, `indexado`, `error`, etc. Eso tiene dos consecuencias: el estado sobrevive aunque Redis caduque los resultados, y si alguien **borra la fila**, el trabajo deja de existir para el sondeo (lo verás en el 🔴 de abajo).

**El reducer** (`ingesta.ts:85-139`) es puro y está testeado sin React (`ingesta.test.ts`). Cada trabajo lleva su propia fase porque dos ficheros a la vez pueden acabar distinto. Las fases nuevas de `#45` son `rechazado`, `duplicado`, `pendiente` y `descartado`, más dos acciones especiales:

- `reencolar`: un pendiente que se resuelve con *reemplazar* o *conservar* vuelve a `en-cola` y se vuelve a sondear con el `job_id` que devuelve `resolver_documento`.
- `seguir`: si resuelves un pendiente **desde la lista** y no estaba en la cola (porque recargaste la página), se añade a la cola para seguirlo.

**Las referencias contra cierres obsoletos (*stale closures*).** `pollear` es un `useCallback` con dependencias `[]`, así que se crea una vez. Pero necesita llamar a la versión **actual** de `alTerminar`. La solución es `alTerminarRef`, que se actualiza en cada render con un `useEffect` sin dependencias. Lo mismo hace `trabajosRef` (l. 210-213) para que `resolver` lea la cola actual sin depender de ella y no cambie de identidad en cada tic del sondeo. Es el patrón *latest ref*, y lo vas a ver más veces.

**El cupo.** `huecosLibres` (`ingesta.ts:168`) resta los trabajos en `en-cola` o `indexando` al máximo del servidor (`GET /ajustes`, o 5 provisional). El formulario trunca **antes** de subir nada (`repartir`), para no mandar 10 cuerpos completos por la red y recibir 5 errores 429. El límite de verdad sigue siendo el 429 del backend (día 05). Esto es cortesía.

### 2.4 La lista de documentos y la decisión del nivel 3

`ListaDocumentos` pinta un `Badge` por estado (`TONO`, l. 18-26). El estado `indexado` no se rotula porque sería ruido: se enseñan los fragmentos. El botón *Leer* solo aparece en los indexados (l. 158), porque son los únicos con contenido en el visor (día 14).

Cuando un documento es `duplicado` o `pendiente-decision`, el "otro" documento se busca **en la propia lista** (`relacionado()`, l. 83-87), sin pedir nada más. En la cola, en cambio, viene ya resuelto en la respuesta de `trabajo` (`relacionado { id name state }`).

`DecisionPendiente` pone las tres acciones juntas y **ninguna por defecto**. El comentario de las l. 16-22 lo justifica bien: dos facturas casi idénticas pueden ser distintas de verdad. *Reemplazar* ya no borra nada al momento: encola el nuevo con `reemplaza=<id>`, y el worker borra el antiguo **solo cuando el nuevo ha quedado indexado** (`backend/app/worker/jobs.py`, `_borrar_reemplazado`). Si la indexación falla, no pierdes ninguno de los dos.

### 2.5 Conversaciones

`ListaConversaciones` agrupa por fecha (`agruparPorFecha`, sin reordenar, porque el backend ya las manda por `actualizada_en` descendente) y usa filas de una línea. Las acciones de *renombrar* y *borrar* van superpuestas con `position: absolute` y no dentro del `<button>` de la fila. El comentario de las l. 192-197 explica que meter un botón dentro de otro es HTML inválido y rompe la tabulación. Están ocultas hasta el *hover*, pero visibles con `focus-within` para quien usa teclado.

`TituloEditable` guarda con Enter y al perder el foco, y cancela con Escape. Usa una ref `cerrado` para que Enter (que guarda) y el `blur` que provoca no guarden dos veces. Si borras la conversación abierta, `onBorrarActiva` vacía el chat.

---

## 3. Por qué se montó así

**Sondeo y no push.** El worker ya escribe su estado en SQLite. Leer esa fila cada 5 s cuesta casi nada y no exige que el worker publique eventos ni que el gateway mantenga conexiones abiertas. Para una indexación que tarda decenas de segundos o minutos, 5 s de latencia no se notan. El coste: peticiones vacías mientras espera, y una lógica de fin de sondeo que hay que mantener a mano (justo lo que `#45` tuvo que tocar para que `duplicado` y `pendiente-decision` fueran finales, porque sin eso habría sondeado para siempre).

**`useRecurso` casero y no TanStack Query.** Son 48 líneas, sin dependencias, y se entienden enteras. El coste es todo lo que no hace: no hay caché compartida, no revalida al volver a la pestaña, `reintentar` vuelve a `cargando` (ver abajo) y no hay invalidación por clave ("cuando termine una ingesta, invalida `documentos`" se hace pasando `documentos.reintentar` a mano). Con dos recursos se aguanta. Con diez, no.

**La cola en memoria (`useReducer`) y no en el servidor.** Es lo más simple: el trabajo es de esta pestaña. El precio es que un F5 lo olvida todo. El servidor sigue indexando, pero la UI ya no lo sigue (ver abajo).

### Cosas que no cuadran

- 🔴 **Un trabajo huérfano sondea para siempre y se come un hueco del cupo.** El botón *Borrar* de la lista sale **en todos los estados**, también en `en-cola` e `indexando` (`ListaDocumentos.tsx:165-173`), y el backend no lo impide (`document_service.eliminar_documento` no mira el estado). Si borras un documento que está en la cola, `GET /trabajos/{id}` da 404, el gateway devuelve `trabajo: null` y `obtenerEstadoTrabajo` lanza un `ErrorApi` 404. El `catch {}` de `useIngesta.ts:135` lo trata como un error de red y **reintenta cada 5 s, sin tope**. El trabajo se queda con el *spinner*, sin botón de quitar (la X solo sale en fases finales, `FormularioIngesta.tsx:313-317`) y **contando como "en vuelo"** en `huecosLibres`. Cinco de estos y el formulario dice "No caben más por ahora" hasta que recargues. El servidor falso de las e2e reproduce el mismo 404 (`servidor-falso.mjs:257`), pero ningún test lo ejercita.
- 🔴 **El gateway se rompe cuando el backend *añade* un campo.** `queries.py:70` construye `Trabajo(**{**data, ...})` y `queries.py:44` hace `Documento(**d)`. Los tipos de Strawberry son *dataclasses*: un campo nuevo en la respuesta del backend que no esté en el tipo da `TypeError: Trabajo.__init__() got an unexpected keyword argument`, y la query entera falla. Lo comprobarás en el Paso 3. En el frontend, el sondeo se traga ese error por el mismo `catch {}`, así que el síntoma sería **todos los spinners girando para siempre sin un solo mensaje**. Hay dos cosas que conviene interiorizar: el orden de despliegue (gateway primero, luego backend) y que esto pide un mapeo explícito o filtrar por los campos del tipo.
- 🟠 **La lista de conversaciones no se entera de las conversaciones nuevas.** `conversaciones.reintentar` solo se llama al renombrar y al borrar (`ListaConversaciones.tsx:49` y `63`). Si haces la primera pregunta de un hilo nuevo, el hilo **no aparece en la barra lateral** hasta que recargas o renombras otro. Tampoco sube arriba un hilo viejo en el que vuelves a preguntar. El propio `App.tsx:158-168` lo admite al calcular el título ("una conversacion recien creada todavia no esta en la lista"). Lo que hace es esquivar el síntoma, no resolverlo. Además, el backend devuelve **solo las 20 más recientes** (`crud/conversation.py:27`) y no hay paginación: la 21.ª desaparece de la lista **y de la paleta de comandos**.
- 🟠 **F5 durante una indexación.** La cola se pierde (vive en un `useReducer`) y la lista de documentos no sondea: un documento en `indexando` se queda así en pantalla hasta que otra ingesta o un borrado recarguen la lista. No hay ningún botón para refrescarla salvo cuando ha fallado.
- 🟡 **Recargar es parpadear.** `reintentar` pasa a `cargando` (`useRecurso.ts:42-45`), y `ListaDocumentos` pinta *skeletons* en `cargando` (l. 89). Así que cada ingesta que termina y cada borrado vacían la lista un instante y la vuelven a pintar. Se pierde el *scroll*, y `hayDocumentos` pasa a `null` mientras tanto. Un `recargar` que conserve los datos viejos mientras llegan los nuevos (*stale-while-revalidate*) lo evitaría.
- 🟡 **`mensajeDeIngesta` se ha quedado atrás** (`ingesta.ts:146-154`). Desde `#45`, `POST /indexar` con una ruta que no existe responde **400** (`"No se puede leer '/docs/x.pdf': No such file or directory"`), pero la UI la sustituye por *"El servidor ha rechazado el fichero: puede estar vacío"*. El texto del 500 (*"Revisa que la ruta exista"*) describía el comportamiento anterior. Y el 409 genérico dice *"Ya estaba indexado"* también cuando la ruta es la misma **pero el contenido ha cambiado** (el `origin` es único en la tabla). En ese caso no hay forma de reindexar sin borrar antes. El comentario de `documentos.ts:109` sigue siendo cierto, pero el mensaje engaña.
- 🟡 **`size` solo existe para las subidas.** El frontend nunca manda `size` en `indexar(file_path, type)`, y `POST /indexar` lee el fichero entero para el hash (`huellas.hash_fichero`) pero no apunta cuántos bytes ha leído. Lo vas a notar en el ejercicio.
- 🟡 **`resolverDocumento` en `App.tsx:126-130`** es un `useCallback` que depende de `ingesta`, y `useIngesta` devuelve un objeto literal nuevo en cada render. El `useCallback` no memoriza nada.
- 🟡 **El gateway no pasa su propio linter en `main`:** `uv run ruff check app tests` da 3 errores (`I001` en dos tests, `SIM117` en `test_proxy.py`). No es grave, pero confirma lo que verás el día 19: no hay CI para el gateway.

---

## 4. Ejercicio (~40 min)

Rama `ejercicio/dia-15` desde `main`. Objetivo: **llevar un dato nuevo del trabajo de indexación desde SQLite hasta la cola de la UI**, pasando por las tres capas, y ver con tus propios ojos dónde se rompe el contrato si cambias las capas en el orden equivocado.

El dato es **el tamaño del fichero** (`documents.size`), que ya está en la fila y nadie enseña. Al terminar, una subida mostrará `41 frag.  2,3 MB`.

No necesitas levantar ningún servicio: todo va por tests.

### Paso 1 — Rama y línea base (3 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-15 origin/main
(cd backend && uv run pytest tests/api/test_jobs.py -q)   # esperado: 7 passed
(cd gateway && uv run pytest -q)                          # esperado: 66 passed
(cd frontend && npm ci && npx vitest run)                 # esperado: 14 files · 117 tests
```

### Paso 2 — Backend: el test primero y luego el campo (7 min)

En `backend/tests/api/test_jobs.py`, en `test_trabajo_existente_devuelve_su_estado`, añade una línea después de `assert cuerpo["name"] == "a.pdf"`:

```python
    assert cuerpo["size"] == 100
```

```bash
cd backend && uv run pytest tests/api/test_jobs.py -q    # esperado: 1 failed (KeyError: 'size')
```

Ahora, en `backend/app/api/schemas.py`, al final de `class TrabajoEstadoOut` (después de `pct_antiguo_en_nuevo`), añade:

```python
    size: int | None = Field(
        default=None,
        description="Bytes del fichero recibido. null en las URL y si no se midio.",
    )
```

Y en `backend/app/api/routers/jobs.py`, dentro del `TrabajoEstadoOut(...)`, añade la última línea:

```python
        pct_antiguo_en_nuevo=doc.pct_antiguo_en_nuevo,
        size=doc.size,
    )
```

```bash
uv run pytest tests/api/test_jobs.py -q    # esperado: 7 passed
uv run ruff check app/api/schemas.py app/api/routers/jobs.py tests/api/test_jobs.py
cd ..
```

### Paso 3 — Gateway: rómpelo antes de arreglarlo (8 min)

Simula que el backend nuevo ya está desplegado y el gateway todavía no. En `gateway/tests/conftest.py`, en el trabajo `"abc-123"` del doble, añade el campo que ahora manda el backend:

```python
                "num_chunks": 12,
                "error_message": None,
                "size": 2048,
            },
```

```bash
cd gateway && uv run pytest -q 2>&1 | tail -4
```

Esperado (es lo que obtuve yo):

```text
TypeError: Trabajo.__init__() got an unexpected keyword argument 'size'
FAILED tests/test_queries.py::test_trabajo_encontrado - assert [GraphQLError(...
1 failed, 65 passed
```

**Pega esta salida en la entrega.** Es lo que pasaría en producción si despliegas el backend antes que el gateway: la query `trabajo` falla entera, también para los clientes que no piden `size`.

Arréglalo. En `gateway/app/schema/types.py`, al final de `class Trabajo`:

```python
    # Bytes del fichero recibido. Null en las URL.
    size: int | None = None
```

Y en `gateway/tests/test_queries.py`, justo antes de `test_trabajo_no_encontrado_devuelve_null`:

```python
@pytest.mark.asyncio
async def test_trabajo_trae_el_tamano_del_fichero(fake_client):
    result = await schema.execute(
        '{ trabajo(job_id: "abc-123") { size } }',
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["trabajo"]["size"] == 2048
```

```bash
uv run pytest -q                                          # esperado: 67 passed
uv run ruff check app/schema/types.py                     # el resto de ruff ya fallaba en main (3 errores), no es tuyo
cd ..
```

### Paso 4 — Frontend: del contrato a la pantalla (15 min)

Trabaja desde `frontend/`. Son seis cambios pequeños y en este orden: contrato, modelo, hook y vista.

**4.1 · `src/shared/api/documentos.ts`.** En `QUERY_TRABAJO`, añade `size` en una línea nueva después de `pct_antiguo_en_nuevo`:

```ts
      documento_id relacionado { id name state } pct_nuevo_en_antiguo pct_antiguo_en_nuevo
      size
```

**4.2 · `src/shared/api/types.ts`.** Al final de `TrabajoEstado`:

```ts
  /** Bytes del fichero recibido. null en las URL. */
  size: number | null;
```

**4.3 · `src/features/documentos/ingesta.ts`.** Tres cambios y una función nueva:

- En `type Trabajo`, debajo de `fragmentos?: number;`:

```ts
  /** Bytes que recibió el servidor. Solo cuando la fase es 'hecho'; null en las URL. */
  tamano?: number | null;
```

- En `AccionIngesta`, cambia la variante `hecho` por:

```ts
  | { tipo: 'hecho'; id: string; fragmentos: number; tamano?: number | null }
```

- En el `case 'hecho'` del reducer, añade `tamano: accion.tamano,` debajo de `fragmentos: accion.fragmentos,`. Y justo encima del comentario `/** Trabajos que el servidor tiene ahora mismo`, añade la función de formato:

```ts
/**
 * 2_411_724 → «2,3 MB». En base 1024, que es como lo cuenta el límite de
 * 50 MB del formulario (`TAMANO_MAXIMO`). Un decimal basta para reconocer el
 * fichero; más sería ruido.
 */
export function formatearTamano(bytes: number): string {
  const unidades = ['B', 'KB', 'MB', 'GB'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  const cifra = i === 0 ? String(valor) : valor.toFixed(1).replace('.', ',');
  return `${cifra} ${unidades[i]}`;
}
```

**4.4 · `src/features/documentos/useIngesta.ts`.** En `pollear`, en la rama `estado.status === 'indexado'`, sustituye el `despachar` por:

```ts
          despachar({
            tipo: 'hecho',
            id,
            fragmentos: estado.num_chunks,
            tamano: estado.size,
          });
```

**4.5 · `src/features/documentos/FormularioIngesta.tsx`.** Cambia el import a `import { formatearTamano, repartir } from '@/features/documentos/ingesta';` y sustituye el bloque `{trabajo.fase === 'hecho' ? (<Badge ...>) : null}` por:

```tsx
              {trabajo.fase === 'hecho' ? (
                <span className={'flex items-center gap-2'}>
                  <Badge tono="exito">{trabajo.fragmentos} frag.</Badge>
                  {trabajo.tamano != null ? (
                    <span className={'tabular text-[0.6875rem] text-tenue'}>
                      {formatearTamano(trabajo.tamano)}
                    </span>
                  ) : null}
                </span>
              ) : null}
```

**4.6 · Tests.** En `src/features/documentos/ingesta.test.ts`, añade `formatearTamano,` al `import` (en orden alfabético, entre `enVuelo` y `huecosLibres`) y, al final del fichero:

```ts
describe('el tamaño del trabajo', () => {
  it('el reducer guarda el tamaño que manda el servidor al terminar', () => {
    const t = aplicar([
      { tipo: 'encolar', id: 'a', origen: 'manual.pdf', clase: 'subida' },
      { tipo: 'hecho', id: 'a', fragmentos: 41, tamano: 2_411_724 },
    ]);
    expect(t[0]).toMatchObject({ fase: 'hecho', fragmentos: 41, tamano: 2_411_724 });
  });

  it('formatea en base 1024 y con coma decimal', () => {
    expect(formatearTamano(512)).toBe('512 B');
    expect(formatearTamano(2048)).toBe('2,0 KB');
    expect(formatearTamano(2_411_724)).toBe('2,3 MB');
    expect(formatearTamano(50 * 1024 * 1024)).toBe('50,0 MB');
  });
});
```

Y al final de `src/features/documentos/FormularioIngesta.test.tsx`:

```tsx
describe('FormularioIngesta · el desenlace de un trabajo', () => {
  it('enseña los fragmentos y el tamaño de lo que se indexó', () => {
    const ingesta: Ingesta = {
      trabajos: [
        {
          id: 't1',
          origen: 'manual.pdf',
          clase: 'subida',
          fase: 'hecho',
          fragmentos: 41,
          tamano: 2_411_724,
        },
      ],
      indexar: vi.fn(),
      subir: vi.fn(() => []),
      olvidar: vi.fn(),
      resolver: vi.fn(),
      huecos: MAX,
      maxEnVuelo: MAX,
    };

    render(<FormularioIngesta ingesta={ingesta} />);

    expect(screen.getByText('41 frag.')).toBeInTheDocument();
    expect(screen.getByText('2,3 MB')).toBeInTheDocument();
  });
});
```

```bash
npx vitest run                # esperado: Test Files 14 passed · Tests 120 passed
npm run typecheck
npm run lint
npx prettier --check src      # si se queja: npx prettier --write src/features/documentos src/shared/api
```

### Paso 5 — Commit y push (3 min)

```bash
cd ~/ruta/AGENT4U
git status --short            # 13 ficheros: 3 backend, 3 gateway, 7 frontend
git add backend gateway frontend/src
git commit -m "feat(ingesta): el trabajo dice el tamaño del fichero, de SQLite a la cola"
git push -u origin ejercicio/dia-15
```

### Preguntas (responde con tus palabras)

1. Dibuja el recorrido de `size` desde la columna `documents.size` hasta el `<span>` de la cola, nombrando **cada fichero y cada función** por los que pasa.
2. En el Paso 3 has visto romperse el gateway por un campo *añadido*. ¿En qué orden desplegarías las tres piezas para que nunca falle? ¿Qué cambiarías en `queries.py` para que un campo desconocido no rompa la query? Da dos opciones y el coste de cada una.
3. Si el gateway hubiera estado roto en producción, ¿qué habría visto el usuario en la cola? Señala la línea de `useIngesta.ts` responsable y propón cómo distinguir "error de red, reintenta" de "esto no se va a arreglar solo".
4. ¿Para qué orígenes (`subida`, `fichero` por ruta, `url`) llega `size` con valor y para cuáles llega `null`? Justifícalo con las líneas de `indexation.py` y de `documentos.ts`. Para las subidas, el navegador ya conoce `File.size`. ¿Por qué tiene sentido igualmente que el dato venga del servidor?
5. Reproduce mentalmente el 🔴 del trabajo huérfano: ¿qué pasos de usuario lo provocan? ¿Por qué acaba bloqueando el formulario? Propón el arreglo más pequeño en el frontend y el más pequeño en el backend.
6. ¿Por qué `pollear` usa una cadena de `setTimeout` y no `setInterval`? ¿Para qué sirve `alTerminarRef` y qué pasaría si `pollear` llamara directamente a `alTerminar`?
7. Haz una pregunta en una conversación nueva. ¿Aparece en la barra lateral? Explica por qué y dónde la recargarías (fichero y momento exacto del flujo del día 13).

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-15` creada desde `main` y subida, con un commit que solo toca los 13 ficheros del ejercicio.
- [ ] La salida en **rojo** del Paso 2 (`KeyError: 'size'`) y la del Paso 3 (`TypeError ... unexpected keyword argument 'size'`) pegadas en la entrega.
- [ ] `uv run pytest tests/api/test_jobs.py` en backend: 7 passed. `uv run pytest` en gateway: 67 passed.
- [ ] `npx vitest run` con 14 ficheros y 120 tests en verde; `npm run typecheck`, `npm run lint` y `npx prettier --check src` limpios.
- [ ] Las 7 preguntas respondidas con tus palabras, citando ficheros y líneas.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

**Bonus (opcional, 20-30 min):** elige uno.

- **(a) Que `size` sea verdad también por ruta.** En `POST /indexar`, si `body.size` es `None`, usa `os.path.getsize(body.file_path)` (ya sabes que el fichero se puede leer, porque acabas de calcular su hash). Añade un test en `tests/api/test_indexation.py` que indexe una ruta sin `size` y compruebe con `GET /trabajos/{id}` que llega el tamaño real.
- **(b) Matar al huérfano.** En `useIngesta.ts`, si `obtenerEstadoTrabajo` lanza un `ErrorApi` con `estado === 404`, despacha `fallo` con *"El documento ya no existe: se borró mientras se indexaba."* y deja de sondear. Escribe el test con `vi.useFakeTimers()` y un `vi.mock('@/shared/api/documentos')`.

Entrega antes de las **8:30 del jueves 19-nov**:

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-15.md
# ...rellena dia-15.md: salidas en rojo y en verde, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-15.md
git commit -m "entrega día 15" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code y te revisa la entrega y la rama al momento.

---

## 5. Para profundizar (opcional)

- React, `useReducer` (reducers puros, acciones y por qué el estado complejo va mejor así): <https://react.dev/reference/react/useReducer>
- Strawberry, *object types*: cómo se definen los tipos y por qué son *dataclasses* (la raíz del `TypeError` de hoy): <https://strawberry.rocks/docs/types/object-types>

---

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la sección *11. Frontend: cliente de API y flujos* debería cubrir:

- Dónde se piden las listas (una vez, en `App`, con `useRecurso`) y por qué bajan por props a componentes presentacionales.
- El ciclo de una ingesta: los filtros del formulario, la subida REST, la cadena de `setTimeout` contra `query trabajo` (que lee SQLite, no Redis) y los siete desenlaces, incluidos los tres de la deduplicación y la decisión del nivel 3 sin acción por defecto.
- El patrón *latest ref* (`alTerminarRef`, `trabajosRef`) y por qué el reducer es puro.
- El contrato frágil del gateway (`Tipo(**data)`) y el orden de despliegue que impone, con tu `TypeError` como prueba.
- Los huecos conocidos: el trabajo huérfano que sondea para siempre, la lista de conversaciones que no se recarga, el F5 que olvida la cola y el parpadeo de `reintentar`.

**El jueves 19-nov (día 16):** el *shell*, el sistema de UI y la paleta de comandos. Verás cómo `AppShell` coloca los tres paneles y expone `abrirDocumentos`/`abrirFuentes` por `ref`, qué hay en `shared/ui` (los `Badge`, `Button` e `IconButton` que hoy has usado sin mirarlos) y cómo la paleta mezcla acciones y conversaciones en la misma lista. El ejercicio: añadir un comando nuevo a la paleta.
