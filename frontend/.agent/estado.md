# Estado del frontend de Agent4U

Última actualización: iteración 028 (2026-10-06). Roadmap: **17/17, completo**.
Las 023 a 028 fueron encargos aparte: rediseño de la interfaz, tres cambios de
identidad, el rediseño de la barra y, en la 028, un **sitio editorial de varias
páginas** delante de la aplicación.

**La aplicación vive ahora en `/app`.** `/` es la portada del sitio, que tiene
tres páginas: Inicio, Arquitectura y Tecnologías.

## Puntuación por dimensión

| Dimensión | 023 | 024 | 025 | 026 | 027 | Evidencia |
|---|---|---|---|---|---|---|
| Arquitectura | 5 | 5 | 5 | 5 | **5** | UI, estado y datos separados. El shell recibe las tres zonas por props y no sabe nada del dominio. Falta router. |
| Capa de datos | 5 | 5 | 5 | 5 | **5** | Cliente único con timeout, cancelación y `ErrorApi` normalizado. Un solo `fetch` en todo `src/`. SSE como generador, probado con cortes. Falta caché entre vistas, que llegará con T05/T10. |
| UX | 5 | 5 | 5 | 5 | **5** | Además de indexar, preguntar y verificar citas: **se ve lo que hace el agente** mientras lo hace (3,5 s que antes eran pantalla quieta), y cada fuente enseña su relevancia, su fragmento y la subconsulta que la encontró. |
| UI | 5 | 5 | 5 | 5 | **5** | Guía de estilo de OpenAI: lienzo blanco, **hairlines en vez de sombras**, radio de 6px en tarjetas, píldora en lo interactivo, **sin color de acento** y un único botón relleno por pantalla. **112/112 AA** medidas. |
| Accesibilidad | 5 | 5 | 5 | 5 | **5** | Auditoría a **0 fallos**: enlaces de salto, orden de tabulación con el chat primero, región de anuncios, landmarks nombrados, AA y `prefers-reduced-motion`. Falta oírlo con un lector real. |
| Calidad | 4 | 4 | 4 | 4 | **5** | Suite de verdad: **60 pruebas de unidad y 3 de punta a punta**, todas en verde tras `npm run verificar` (typecheck, lint, formato, unidad, e2e). Encontró dos fallos reales que 21 iteraciones de validación manual no vieron. Falta contrato compartido con el backend y regresión visual. |

## Decisiones vigentes

- **Nada de commits del agente, y el agente no figura como autor.** Instrucción
  explícita de Pepe en la iteración 003. El trabajo se deja en el árbol de
  trabajo y lo commitea él. No se crean ramas: sin commits no aportan nada.
- **Prohibido tocar el backend y cualquier operación con el remoto.**
- **El roadmap T01-T17 manda sobre el orden**; el feedback de Pepe manda sobre el roadmap.
- **`src/shared/Distribucion.md` es la regla de estructura**, actualizada en la
  iteración 003 a la nomenclatura del roadmap. Los imports van siempre con `@/`.
- **El alias `@/` vive en dos sitios que deben ir a la vez**: `paths` en
  `tsconfig.app.json` y `resolve.alias` en `vite.config.ts`. Sin `baseUrl`,
  deprecado en TypeScript 6.
- **`strictPort: true`**: el backend solo permite CORS desde `localhost:5173`, así
  que arrancar en otro puerto deja la app rota en silencio.
- **Estado de vista = una variante, no varios booleanos.** `ListaConversaciones`
  usa `{ fase: 'cargando' } | { fase: 'error' } | { fase: 'listo' }`. Es el patrón
  a repetir en las demás vistas con datos.
- **Estilos: CSS Modules + variables CSS.** Decidido por defecto en la iteración
  004 tras tres iteraciones sin respuesta. Cero dependencias; los tokens son CSS
  estándar y sobreviven a una migración a Tailwind.
- **El color se nombra por rol, nunca por tono.** Ver `design-system.md`.
- **Dos gradientes**: `--gradiente-marca` solo donde no hay texto encima;
  `--gradiente-acento` cuando sí lo hay, porque sus extremos cumplen AA.
- **El backend ya expone `/health` y `/health/qdrant`** (añadidos en la
  iteración 007 con permiso expreso de Pepe). `/health/qdrant` responde 200
  aunque Qdrant esté caído: hay que mirar `status`, no el código HTTP.
- **Para apuntar el frontend a otro backend al validar hay que usar
  `.env.local`**: el `.env` del proyecto gana a la variable de entorno que se le
  pase a Vite.
- **La lógica del chat vive en un reducer puro** (`features/chat/estado.ts`), no
  en el hook: el riesgo está en el orden de los eventos del stream y así se
  prueba sin React.
- **Cada vista posee su propio scroll.** El shell solo acota el espacio. El chat
  lo necesita para su auto-scroll, que solo actúa si el usuario está al fondo.
- **Todo el HTML generado pasa por `markdownAHtml`**, que parsea y después
  sanea con DOMPurify. Es el único origen permitido de
  `dangerouslySetInnerHTML`; cualquier otro uso es un fallo de seguridad.
- **Los botones dentro del HTML inyectado se añaden tras sanear** y se manejan
  por delegación: así no son algo que el modelo pueda falsificar. Los
  marcadores `[n]` se sustituyen sobre **nodos de texto**, nunca sobre la cadena
  de HTML, y solo si el número corresponde a una fuente real.
- **Pedirle una acción puntual a un componente va por `useImperativeHandle`**,
  no por una prop que se mire desde un efecto: eso es un render en cascada.
- **`POST /indexar-fichero` es el camino para subir**, añadido en la iteración
  013 con permiso de Pepe. `POST /indexar` sigue recibiendo una ruta del
  servidor, y las dos formas conviven en el formulario.
- **El nombre de un fichero subido nunca se usa tal cual**: se reduce con
  `basename` y se comprueba con `is_relative_to` que el destino no sale de la
  carpeta de subidas.
- **Un `FormData` se manda sin `Content-Type`**: el `boundary` lo pone el
  navegador y fijarlo a mano rompe el multipart.
- **La ingesta va sin tiempo límite** (`tiempoLimiteMs: 0`): convertir, trocear
  y vectorizar tarda mucho más que los 15 s por defecto del cliente.
- **Antes de optimizar, medir.** En la iteración 021 dos de las tres sospechas
  del backlog resultaron falsas y no se tocó nada por ellas.
- **`npm run verificar` es la única puerta**: typecheck, lint, formato, unidad y
  punta a punta. Si pasa, se puede entregar; si no, no.
- **El servidor falso de las pruebas vive en el repositorio**
  (`pruebas-e2e/servidor-falso.mjs`), no en `/tmp`. Las rarezas del contrato se
  codifican donde se pueden leer: el 404 de colección vacía, el stream SSE, el
  preflight de `PATCH` y la persistencia del turno.
- **Lo que la aplicación usa del navegador se rellena en el arranque de las
  pruebas**, no prueba a prueba: `matchMedia`, `scrollIntoView` y
  `HTMLDialogElement.prototype.showModal` no existen en jsdom.
- **Playwright con `channel: 'chrome'`**: usa el Chrome de la máquina en vez de
  descargar navegadores. Nadie tiene que preparar nada.
- **Un componente que inyecta HTML debe ir memoizado.** Cualquier re-render hace
  que React reescriba el HTML, y los nodos que había dentro desaparecen: un clic
  en curso se pierde. Lo encontró la prueba de punta a punta de la 022.
- **Lo que hay que persistir se guarda en el manejador del evento, no en un
  efecto.** Los efectos corren después de pintar, así que hay un fotograma en el
  que la pantalla ya muestra algo que todavía no está guardado.
- **El sitio editorial vive en `src/sitio/` y la aplicación en `src/app/` +
  `src/features/`.** Comparten los tokens y nada más. `/app` va fuera del
  layout del sitio: es otro árbol con su propia barra.
- **`datos/secciones.ts` manda sobre la navegación, el bloque "Siguiente" y la
  rejilla de la portada a la vez.** Tres listas separadas es como se acaba con
  una navegación que no coincide con el recorrido.
- **Los ids de los filtros SVG son globales al documento**: dos portadas con el
  mismo id comparten filtro. Cada instancia genera el suyo con `useId`.
- **Un bucle infinito sobre SVG va en CSS, no en Motion**: el compositor lo
  lleva solo sin pasar por React en cada fotograma.
- **El sitio solo tiene las secciones que están escritas.** Añadir una son una
  entrada en `datos/secciones.ts`, su fichero de datos y una `<Route>`.
- **La tarjeta de artículo no lleva marco**; las de dato sí. Un hairline
  alrededor de todo convierte una revista en un panel de control.
- **La barra superior es una TOOLBAR, no una cabecera de web.** Los dos
  interruptores de panel hacen de topes, cada uno del lado que controla, y en
  medio va el contexto: qué conversación se está mirando. Logo-izquierda /
  iconos-derecha es el patrón de una web de marketing y no encaja sobre una
  aplicación.
- **El estado se calla cuando no hay nada que contar.** Un punto tenue si todo
  va bien; color y palabra solo cuando hay que hacer algo. El texto completo
  sigue en el tooltip y en `.solo-lectores`.
- **Dos iconos parecidos en la misma barra se confunden**, aunque por separado
  se distingan: el símbolo de la marca y el de documentos eran los dos una hoja
  con renglones.
- **La identidad sigue la guía de estilo de OpenAI**: lienzo blanco, hairlines
  al 12% de negro como única estructura, radio de 6px en tarjetas, píldora en
  todo lo interactivo y **ningún color de marca**. Ver `design-system.md`.
- **Hairlines, no sombras.** Es la inversión de lo que decía la 025, y viene
  de la guía: las tarjetas no llevan sombra y la estructura la dan las líneas
  finas y el aire. Las sombras solo sobreviven en lo que flota de verdad
  (modales y popovers).
- **Un solo botón relleno por pantalla.** El negro sólido es "el punto final de
  una frase monocroma"; rellenar un segundo botón lo deja sin valor.
- **Sin color de acento, el estado se dice con peso y borde**: hairline opaco
  para la tarjeta activa, relleno negro para la cita elegida, fondo Ash y peso
  medio para el hilo abierto.
- **Los colores de estado son la única excepción al monocromo.** Un error sin
  color es un error que no se ve.
- **Al medir contraste, el peor caso es la superficie gris, no el fondo.** Una
  tecla o un chip van sobre `#ececee`, no sobre `#f5f5f7`; medir solo contra el
  fondo deja pasar fallos de verdad.
- **Los valores de Apple no pasan AA.** Su `#86868b` da 3.1:1 y su `#0071e3`
  4.31:1; aquí se usan `#636366` y `#0066cc`. Se toma el lenguaje, no los hex.
- **Sobre un azul claro, el texto va casi negro, no blanco.** En el tema oscuro
  el blanco se queda en 3.02:1. Es lo que hace iOS.
- **Una `var()` que no resuelve no es un error en CSS: simplemente no pinta.**
  Al borrar los tokens de gradiente quedaron cinco usos colgados que ni el
  typecheck ni el linter detectaron. Tras renombrar o borrar un token hay que
  hacer `grep` del nombre viejo por todo `src/`.
- **Un gradiente suele tapar que no hay jerarquía.** Cuando la jerarquía existe
  —fondo, superficie, sombra— sobra: se pasó de 23 usos a cero sin echar nada
  de menos.
- **El logo va monocromo, en `currentColor`.** Una marca que se apoya en su
  forma y no en un relleno de color envejece mejor y funciona en los dos temas
  sin una regla extra.
- **Los estilos son Tailwind v4 sobre los mismos tokens**, con `@theme inline`
  para que el cambio de tema siga propagándose. La única excepción es
  `Respuesta.module.css`: estiliza HTML que genera `marked`, donde no se pueden
  poner clases. Ver `design-system.md`.
- **No hay variante `dark:`.** Los tokens se nombran por rol y ya son el color
  correcto en los dos temas; duplicar la decisión en cada clase perdería el
  sistema.
- **El backend manda hechos y la interfaz pone las palabras.** El evento `paso`
  trae el nombre del nodo y unas cifras, no texto para el usuario: así una
  etiqueta se reescribe sin tocar Python.
- **El score del reordenador no es un porcentaje.** No está acotado y puede ser
  negativo. La barra de relevancia es **relativa al mejor fragmento de esa
  respuesta**; presentarlo como "87%" sería inventarse una escala.
- **Un popover sobre HTML inyectado va en CSS puro**, nunca con estado de React:
  el hover re-renderizaría el componente, React reescribiría el HTML y el clic
  se perdería entre el `mousedown` y el `click`.
- **Un aviso informa, no estorba.** Los toasts van sin `pointer-events` salvo su
  botón de cerrar, y abajo a la derecha: centrados abajo tapaban el composer.
- **Lo que devuelve un hook y alimenta un efecto va memoizado.** Un objeto nuevo
  en cada render redispara el efecto; si ese efecto crea algo, se realimenta.
- **No parsear colores a mano al auditar contraste.** Tailwind v4 emite
  `color-mix(in oklab, …)` para las opacidades; hay que resolverlos con el
  navegador (canvas + `getImageData`) y componer las capas con su alfa.
- **Las fuentes van empaquetadas, no pedidas a Google**: la aplicación es local
  y tiene que arrancar sin red.
- **No esperar a un nodo que existe desde el principio.** El `<article>` de la
  respuesta lo crea el reducer vacío al enviar la pregunta, así que esperarlo no
  espera al stream. La señal de que la respuesta llegó es el markdown
  renderizado.
- **`getByLabel` busca por subcadena**: `'Tu pregunta'` casa también con
  `'Escribe tu pregunta'`. Para desambiguar, el rol.
- **Para cronometrar un render, medir el `dispatchEvent` síncrono**; esperar a
  `requestAnimationFrame` devuelve siempre el coste de los frames (~33 ms) y
  tapa lo que se quería medir.
- **Las mediciones de bundle se hacen sobre el build**, no en desarrollo: Vite
  sirve los módulos sin agrupar y no se parece al resultado.
- **El orden del DOM sigue a la importancia, no a la posición en pantalla**: el
  `<main>` va antes que los laterales y el grid lo recoloca. La tabulación sigue
  al documento.
- **La región `aria-live` existe siempre, vacía.** Montarla al tener algo que
  decir no anuncia nada: el lector solo lee los cambios de una región que ya
  estaba vigilando. Y repetir el mismo texto tampoco suena: hay que alterarlo.
- **Los atajos de una sola tecla no se disparan dentro de campos de texto**;
  los que llevan modificador sí, porque no se teclean por accidente.
- **Un diálogo cuyo estado debe nacer limpio monta su contenido al abrirse**, en
  vez de resetearlo desde un efecto: eso es un render en cascada.
- **Las capacidades del servidor se piden, no se codifican.** `GET /ajustes` da
  los modelos y los límites; la interfaz no duplica nada ni ofrece opciones que
  el backend vaya a rechazar.
- **Se guarda lo que el usuario eligió, no el valor efectivo.** `null` significa
  "lo que diga el servidor", y entonces el parámetro se omite del cuerpo. Si se
  guardase el efectivo, cambiar el defecto del servidor no le llegaría nunca.
- **El modelo va contra lista blanca.** Un fallo del LLM sale dentro de un 200,
  a mitad del stream, donde ya no se puede devolver un código de error: hay que
  rechazarlo antes de empezar.
- **Todo el acceso a `localStorage` pasa por `shared/lib/almacen.ts`**, que
  nunca lanza. No debe quedar ningún `localStorage` suelto en `src/`.
- **La densidad escala `--escala-densidad`, y solo el espaciado.** Texto y
  tamaños mínimos de los controles no escalan: encoger el área pulsable es justo
  lo que no debe hacer un modo compacto.
- **Para comprobar que un token tiene efecto, medir un elemento real**:
  `getPropertyValue` devuelve la custom property sin resolver.
- **Lo que se persiste en local se ancla a datos estables del backend.** Las
  valoraciones usan `conversacionId:posición`, no el id del mensaje: ese cambia
  de UUID local a numérico al recargar.
- **Renombrar no toca `actualizada_en`**: la lista se ordena por esa fecha y
  renombrar no es conversar. Para esquivar el `onupdate` hace falta un
  `update()` explícito con la columna en `values()`; reasignar el atributo con
  su mismo valor no basta.
- **`PATCH` exige preflight CORS.** El backend lo permite
  (`allow_methods=["*"]`); cualquier stub de pruebas tiene que listarlo también.
- **El repositorio del historial es el backend**, no el navegador. En local solo
  se guarda el **id** del hilo abierto: duplicar los mensajes crearía una
  segunda fuente de verdad que se desincronizaría al borrar una conversación.
- **Un efecto que persiste estado no debe escribir en el primer render**: el
  valor inicial (`null`) borraba la memoria antes de poder restaurarla.
- **Al validar texto con `innerText`, ignorar mayúsculas**: devuelve el texto ya
  transformado por `text-transform`.
- **Las peticiones compartidas se elevan a `App`**: la sonda de salud y la lista
  de documentos las usan varios sitios, y cada consumidor con su propio hook
  significaba una petición por consumidor.
- **Los estados que todavía no se conocen son `null`, no `false`.** Afirmar "no
  hay documentos" mientras se carga manda al usuario a buscar un problema que no
  existe, y un error al listar no es una lista vacía.
- **React reescribe el HTML inyectado al re-renderizar.** Al validar, volver a
  consultar los nodos tras cada cambio de estado; las referencias viejas quedan
  huérfanas.
- **Al validar con red real, usar un buzón de resultados** (el probe hace POST al
  stub y se lee el fichero): `--virtual-time-budget` vuelca el DOM antes de que
  llegue la red y hace parecer que nada funciona.
- **Una sola puerta a la red**: `shared/api/cliente.ts`. Ninguna feature llama a
  `fetch`. Los fallos salen siempre como `ErrorApi` con un `tipo`, para que la UI
  decida mirando el tipo y no parseando mensajes.
- **Cancelar no es fallar**: una cancelación pedida por el llamante propaga el
  `AbortError` original, no un `ErrorApi`.
- **El `detail` del backend solo se enseña en los 4xx.** En los 5xx es técnico y
  se sustituye por un mensaje propio.
- **Las rarezas del contrato se absorben en `shared/api`**, no en las vistas: el
  404 de colección vacía de `/documentos` se traduce a `[]`.
- **Sin librería de datos todavía.** TanStack Query se descartó en la iteración
  005: con una sola vista aporta más superficie que valor. Reconsiderar en T05/T10.
- **Los paneles laterales son `<dialog>` nativos en móvil**, no divs. El foco
  atrapado, Escape y el fondo inerte vienen del navegador. El `display` va atado
  a `[open]`: un `display` suelto en el selector base gana a la regla del user
  agent y deja los drawers visibles al cargar.
- **El shell recibe sus tres zonas por props** y no importa nada del dominio.
- **El punto de ruptura vive en `useMediaQuery.ts`** (`CONSULTA_ESCRITORIO`) y en
  `AppShell.module.css`; los dos tienen que ir a la vez.
- **Chrome headless en macOS no baja de 500 px de ancho.** Para validar 375 px hay
  que medir con la app dentro de un iframe del mismo origen, no con
  `--window-size`. Una captura a 375 px recorta sin que haya desbordamiento.

## Deuda conocida

1. ~~Sin runner de tests~~ — **cerrado en la iteración 022**. Lo que queda del
   tema: no hay contrato compartido con el backend (el servidor falso lo copia a
   mano), ni cobertura medida, ni regresión visual, ni CI, y solo se prueba en
   Chrome.
2. `oxlint` con 2 reglas.
3. ~~`preguntar.ts` y `documentos.ts` sin consumidor~~ — cerrado en T05/T09.
4. Escape y el clic en el backdrop del Drawer no se han podido verificar:
   Chrome headless no emite el evento `close`. Conviene probarlo a mano.
5. ~~Cada trozo del stream provoca un render~~ — medido en T16: 0,10 ms. No era un problema.
6. ~~La lista de conversaciones no abre el hilo~~ — cerrado en T10.
7. ~~El bundle sube por `marked` + `dompurify`~~ — diferido en T16: 319 → 245 kB.
8. `getComputedStyle` leído justo tras un cambio de estado devuelve el valor a
   medio animar. Al validar estilos con transiciones, esperar antes de medir.
9. El panel de fuentes solo muestra las del último mensaje con fuentes.
10. La ingesta muestra un spinner, no progreso real: el endpoint responde de una
    sola vez. Una barra necesitaría SSE también en la indexación.
11. Pepe tiene que reiniciar su backend y hacer `uv sync`: hay endpoints nuevos
    y una dependencia nueva (`python-multipart`).
13. Nadie ha pasado un lector de pantalla real por la aplicación.
14. `Card` y `Textarea` están sin consumidor desde que las vistas tienen
    estilos propios.
13. El renombrado no tiene deshacer: una vez guardado, el título anterior se
    pierde.
3. El `Tooltip` no reposiciona según el hueco libre: va anclado al borde final.
4. La navegación por teclado no se ha podido validar de forma automatizada.
6. La rama `feat/frontend-iter-002-estructura` tiene commits con el agente como
   coautor. Su contenido ya está en el árbol; se puede borrar.
7. Existe un `stash@{0}` previo, ajeno al agente. No se toca.

## Preguntas abiertas

Ninguna que bloquee: el roadmap T01-T17 está completo.

Lo que depende de Pepe, por orden de urgencia:

1. **Reiniciar el backend y hacer `uv sync`.** Hay cuatro grupos de endpoints
   nuevos (`/health`, `/indexar-fichero`, `PATCH /conversaciones/{id}`,
   `/ajustes`) y una dependencia nueva (`python-multipart`). Su proceso corre sin
   `--reload`, así que hoy no los sirve.
2. **Pasarle VoiceOver** (Cmd+F5) al flujo de preguntar. El árbol de
   accesibilidad está verificado; cómo suena, no.
3. **Probar a mano Escape y el clic en el backdrop de los drawers.** Chrome
   headless no emite `close`.
4. **Decidir sobre CI.** `npm run verificar` está listo; enchufarlo a GitHub
   Actions implica tocar el repositorio remoto, que es cosa suya.
5. **Commitear.** Todo el trabajo de las 22 iteraciones sigue sin commitear, por
   instrucción expresa.

Las de `/health` y estilos quedaron resueltas en las iteraciones 007 y 004.
