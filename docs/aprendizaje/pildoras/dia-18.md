# Píldora 18 — Tests del frontend: Vitest, Testing Library, Playwright y axe

**Lunes 23-nov-2026 · sesión corta: 15 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 17

No hay entrega del día 17: en `origin/aprendizaje` no existe `entregas/dia-17.md` y en el remoto no hay ninguna rama `ejercicio/dia-*`. Tampoco ha llegado tarde ninguna anterior. Sin nota.

El ejercicio del 17 (`GET /stats` con un test en cada nivel) sigue valiendo tal cual: `main` no se ha movido desde `#45` (`2cf91a8`, 16-nov). Si un fin de semana te sobra tiempo, es el que más rinde de los pendientes, porque hoy lo vas a ver repetido en el frontend: los mismos niveles y el mismo tipo de doble que miente.

Todo lo que cuento está comprobado hoy contra `2cf91a8`. He hecho el ejercicio entero en una copia limpia antes de escribirlo, y las salidas que pego son reales:

- `npx vitest run`: **14 ficheros, 117 tests** en verde, unos 15 s (casi 9 s son montar jsdom). Con el ejercicio terminado, **126**.
- `npx playwright test --list`: **86 tests** (43 por proyecto × 2 proyectos). En el proyecto `chrome`: **42 pasan y 1 se salta**. Con el ejercicio terminado: 43 pasan y 1 se salta.

---

## 1. Concepto clave: tres herramientas, tres preguntas distintas

### 1.1 Qué es real en cada nivel (otra vez)

La pregunta del día 17 vale igual aquí: **¿qué es de verdad y qué es de mentira en este test?**

| Herramienta | Es real | Es de mentira | Pregunta que contesta |
|---|---|---|---|
| **Vitest** sobre una función | La función | Nada | ¿La lógica es correcta? |
| **Vitest + Testing Library** | El componente React y su árbol | El navegador (jsdom), y las *props* (`vi.fn()`) | ¿El componente se comporta bien cuando un usuario lo toca? |
| **Playwright** | Un navegador de verdad (Chrome, WebKit), el *build* de producción | El backend y el gateway (`servidor-falso.mjs`) | ¿La aplicación entera funciona en un navegador? |
| **axe** (dentro de Playwright) | El DOM ya pintado | — | ¿Lo pintado cumple las reglas de accesibilidad que se pueden comprobar con una máquina? |

Dos ideas que debes tener claras:

1. **jsdom no es un navegador.** Es una implementación del DOM en JavaScript que corre dentro de Node. Tiene `document`, eventos y foco, pero **no pinta**: no hay CSS calculado, ni tamaños, ni scroll, ni `<dialog>` modal. Por eso un test de Vitest puede decir "el botón está deshabilitado", pero no "el botón se ve".
2. **Testing Library es una filosofía además de una librería.** Su regla es *"cuanto más se parezcan tus tests a cómo se usa el software, más confianza te dan"*. En la práctica: buscas los elementos **como los busca una persona o un lector de pantalla** (`getByRole('button', { name: 'Enviar' })`, `getByLabelText(...)`), nunca por clase CSS ni por `data-testid` si hay alternativa. Un efecto secundario muy bueno: si no puedes encontrar un botón por su rol y su nombre, probablemente un lector de pantalla tampoco puede.

### 1.2 `fireEvent` frente a `userEvent`

Testing Library trae dos formas de "tocar" un componente:

- `fireEvent.click(boton)` dispara **un** evento `click`. Nada más.
- `userEvent.click(boton)` simula lo que hace una persona: `pointerdown`, `mousedown`, **foco**, `pointerup`, `mouseup`, `click`. Y `userEvent.type` / `keyboard` simula cada tecla con `keydown`, `keypress`, `input`, `keyup`.

En AGENT4U se usa `userEvent` en todo, con **una excepción justificada**: `FormularioIngesta.test.tsx` usa `fireEvent.drop` (líneas 142 y 155) para soltar ficheros, porque `user-event` no simula el arrastrar y soltar. Compruébalo con `grep -rn fireEvent frontend/src`. Es la elección correcta: hoy vas a escribir un test que solo falla si el foco se mueve de verdad, y con `fireEvent` no se movería.

### 1.3 Los dobles en el frontend

Los mismos cinco nombres del día 17, con las herramientas de Vitest:

- `vi.fn()`: un **espía**. Una función que no hace nada y apunta cómo la llamaron. Es lo que pasas como `onGuardar` para luego preguntar `toHaveBeenCalledWith(...)`.
- `vi.stubGlobal('fetch', ...)`: sustituye una global. Es el doble de la red en los tests de `shared/api/`.
- `vi.stubEnv` + `vi.resetModules()`: cambia una variable de entorno de Vite **y** obliga a reimportar el módulo, porque `cliente.ts` lee `import.meta.env.VITE_API_URL` **al importarse** (línea 17).
- `servidor-falso.mjs`: un **fake** completo, un servidor HTTP de 586 líneas que imita al gateway y al backend. Es el `FakeBackendClient` del gateway, pero en grande.

Lo que **no** se usa en ningún sitio: `vi.mock(...)` (sustituir un módulo entero). `grep -rn "vi.mock(" frontend/src` sale vacío. Es una decisión, y buena: se prueba contra la frontera real (las *props*, `fetch`) y no contra la estructura interna de los imports.

### 1.4 Playwright en cuatro conceptos

- **Locator**: una *receta* para encontrar un elemento (`page.getByRole('button', { name: 'Cerrar' })`), no el elemento. Se resuelve **otra vez en cada acción**, así que sobrevive a que React repinte el nodo.
- **Aserciones web-first**: `await expect(locator).toBeVisible()` **reintenta** hasta que se cumple o vence el plazo (5 s por defecto). Es lo que elimina los `sleep`.
- **Modo estricto**: si un locator encuentra **dos** elementos y le pides una acción o una aserción sobre uno, falla con *strict mode violation*. Te va a pasar hoy y es una ayuda, no un estorbo.
- **Proyectos**: la misma suite ejecutada con configuraciones distintas (aquí, Chrome de escritorio e iPhone 13 con WebKit).

---

## 2. Cómo está en AGENT4U

### 2.1 Vitest: la configuración vive en `vite.config.ts`

No hay `vitest.config.ts`. La sección `test` está dentro de `frontend/vite.config.ts` (líneas 15-24):

```ts
  test: {
    // jsdom y no el navegador: estas pruebas son de lógica y de árbol
    // renderizado, no de pintado. Lo visual se valida aparte, en Chrome.
    environment: 'jsdom',
    globals: true,
    // Los ficheros de prueba viven junto a lo que prueban: así se ven al
    // leer el código y no hay que mantener una carpeta espejo.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/pruebas/preparar.ts'],
  },
```

Consecuencias:

- Los tests usan **los mismos alias y plugins que la aplicación**: `@/features/...` funciona igual en el test que en el código. Es la gran ventaja de Vitest sobre Jest en un proyecto Vite: no hay una segunda configuración de transformaciones que mantener.
- Los tests están **al lado** del código: `Composer.tsx` y `Composer.test.tsx` en la misma carpeta. Hay 14 ficheros de test: 3 de componentes (`.test.tsx`) y 11 de lógica (`.test.ts`).
- `globals: true` deja usar `describe`/`it`/`expect` sin importarlos, pero **todos los ficheros los importan igualmente** de `vitest`. Es redundante, pero es el estilo de la casa: síguelo.

### 2.2 `src/pruebas/preparar.ts`: lo que le falta a jsdom

Se ejecuta antes de cada fichero de test. Tiene cuatro partes, y cada una cuenta algo:

1. `import '@testing-library/jest-dom/vitest'`: añade *matchers* como `toBeDisabled()`, `toHaveValue()` o `toHaveFocus()`. El comentario explica por qué no se hace a mano: el estado "deshabilitado" no es solo el atributo `disabled` (un `<fieldset disabled>` deshabilita a sus hijos), y reimplementar esa lógica es equivocarse.
2. `afterEach(cleanup)`: desmonta lo renderizado. Con `globals: true` Testing Library lo hace sola, así que esta línea es un seguro por si algún día se quita `globals`.
3. **Parches de jsdom**: `window.matchMedia`, `Element.prototype.scrollIntoView` y `HTMLDialogElement.prototype.showModal/close`. Son las tres APIs del navegador que los componentes usan y jsdom no implementa.
4. El parche de `<dialog>` **solo** pone `open = true`/`false`. El comentario lo dice: *"se simula lo justo para poder comprobar que se abre y se cierra, no su comportamiento modal"*. O sea: la captura del foco dentro del `Drawer` **no** se puede probar con Vitest. Se prueba en Playwright o no se prueba.

### 2.3 Un test de componente típico: `Composer.test.tsx`

```tsx
function montar() {
  const onEnviar = vi.fn();
  const onDetener = vi.fn();
  render(<Composer enviando={false} onEnviar={onEnviar} onDetener={onDetener} />);
  return { onEnviar, onDetener, campo: screen.getByLabelText(/escribe tu pregunta/i) };
}
```

El patrón se repite en `PaletaComandos.test.tsx` y `FormularioIngesta.test.tsx`:

- Una función `montar()` que renderiza con espías y devuelve lo que el test necesita.
- `userEvent.setup()` **dentro de cada test**, antes de renderizar (es lo que recomienda la documentación de `user-event` v14).
- Las consultas por **rol y nombre accesible**: `getByRole('button', { name: /enviar la pregunta/i })`. Fíjate en que si alguien cambia el `aria-label` del botón, el test falla. Eso es intencionado: el nombre accesible es parte del contrato del componente.

### 2.4 Playwright: `frontend/playwright.config.ts`

Lo más importante, en orden:

- **`webServer` levanta dos procesos** antes de los tests: `node pruebas-e2e/servidor-falso.mjs 8099` (el backend y gateway de mentira) y `npm run build && npx vite preview --port 5178`. Se prueba **el build de producción**, no `vite dev`: es lo que se publica, y así también se comprueba el *fallback* SPA (recargar en `/arquitectura` sin 404).
- **`reducedMotion: 'reduce'` para todo** (línea 29). El comentario es de los mejores del repo: con las animaciones de revelado, Playwright esperaba a elementos en movimiento y hubo *"cuatro falsos fallos y un recorrido que no se podía completar"*. El coste está escrito: las animaciones no quedan cubiertas.
- **Dos proyectos**: `chrome` (con `channel: 'chrome'`, el Chrome instalado en la máquina y no un Chromium descargado) e `iphone` (WebKit real, porque el menú es otro componente por debajo de 768 px y WebKit es el único motor de iOS). Requiere `npx playwright install webkit` una vez.
- **`retries: process.env.CI ? 1 : 0`**: en local ves el primer fallo; en CI se reintenta una vez.
- **`reuseExistingServer: !process.env.CI`**: en local, si ya hay algo escuchando en 8099 o 5178, lo reutiliza. Ojo: si dejaste un `servidor-falso` vivo de otra ejecución, sus datos en memoria siguen ahí.

### 2.5 El doble del gateway: `pruebas-e2e/servidor-falso.mjs`

Es un `http.createServer` de Node sin dependencias. Imita `/health`, `/graphql`, `/indexar-fichero` y `/preguntar` (con SSE de verdad). Tres cosas que tienes que saber:

**a) El estado se parte por proyecto**, no por test (línea 28):

```js
function estadoDe(req) {
  const clave = req.headers['x-sesion-prueba'] ?? 'global';
```

Cada proyecto manda su cabecera (`extraHTTPHeaders` en la config). Se hizo porque Chrome e iPhone corrían a la vez y se pisaban (409 "ya existe"). Pero **todos los tests de un mismo proyecto comparten el mismo mundo**. Vuelvo sobre esto en la sección 3, porque tiene consecuencias.

**b) No parsea GraphQL** (línea 197):

```js
  const campo = /\{\s*([a-zA-Z_]+)/.exec(query)?.[1];
```

Coge el primer nombre después de la primera `{` y hace `switch (campo)`. Cubre los 13 campos del gateway (7 *queries* y 6 *mutations*; los he contado en `gateway/app/schema/queries.py` y `mutations.py`). Pero los **argumentos los lee de `variables`**, que es el nombre que les pone **el frontend**, no el que define el gateway:

```js
    case 'indexar': {
      const ruta = variables.filePath;
```

`filePath` es la variable `$filePath` de `frontend/src/shared/api/documentos.ts:101`. El gateway real no sabe nada de `filePath`: su argumento se llama `file_path` (`mutations.py:19`). El doble está acoplado al cliente, no al servidor que dice imitar.

**c) Devuelve siempre todos los campos**, pida lo que pida la *query*. Si el frontend pide un campo que no existe en el esquema, el gateway real respondería con un error de validación; el doble responde con datos.

### 2.6 axe: accesibilidad en `rutas.spec.ts`

```ts
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const graves = violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
```

axe-core es un motor de reglas: recorre el DOM ya pintado y comprueba lo que se puede comprobar de forma automática (contraste, nombres accesibles, roles válidos, jerarquía de encabezados...). Se le filtra por las etiquetas WCAG 2.0/2.1 A y AA, y el test solo falla con impacto `serious` o `critical`.

Las pruebas de `rutas.spec.ts` se **generan** a partir de `src/routes.ts`: un `for` sobre `RUTAS` filtradas por `RUTAS_VISITABLES`. Añadir una página al mapa la mete sola en el test de accesibilidad. Es una idea excelente... con un hueco que verás en la sección 3.

### 2.7 ESLint solo para las e2e

`frontend/eslint.config.js` aplica **solo** a `pruebas-e2e/**/*.ts`. El resto de `src/` lo revisa oxlint. Las reglas activadas son las que evitan tests intermitentes: `prefer-web-first-assertions`, `no-wait-for-timeout`, `no-force-option`, `no-element-handle` y `missing-playwright-await`. Cada una lleva su porqué en un comentario. Léelas: es la lista de errores que ya se cometieron en este repo.

---

## 3. Por qué se montó así (y qué no cuadra)

**Por qué Vitest y no Jest.** Con Vite, Jest necesita su propia cadena de transformación (Babel o `ts-jest`) y su propia configuración de alias, ESM y CSS. Vitest reutiliza la de Vite. El coste: jsdom sigue siendo jsdom. Vitest tiene un *browser mode* que ejecuta los tests en un navegador real, pero es más lento y aquí no se usa.

**Por qué jsdom y no happy-dom.** happy-dom es más rápido, pero implementa menos. jsdom es el estándar. El precio se ve en la salida: de los 15 s de la suite, unos 9 s son `environment`.

**Por qué un servidor falso y no el stack real en las e2e.** Levantar backend, gateway, Qdrant, Redis, worker y un LLM para cada ejecución es lento, caro (el LLM cuesta dinero) e intermitente (el LLM no responde igual dos veces). El servidor falso hace las e2e **deterministas**: la respuesta siempre tiene un `## El teorema CAP` y tres viñetas, así que el test puede afirmarlo. El coste es el de siempre: **el doble puede mentir**, y nadie comprueba que no lo haga.

**Por qué axe dentro de Playwright y no en Vitest.** Hay `vitest-axe`, pero en jsdom no hay CSS calculado, así que la regla más útil (`color-contrast`) no puede funcionar. En un navegador real, sí.

### Cosas que no cuadran, comprobadas hoy

1. **Un test que solo pasa si corre después de otros.** `flujo.spec.ts:95` (*"Cmd+K abre la paleta y abre una conversación"*) falla si lo ejecutas solo:

   ```bash
   npx playwright test "flujo.spec.ts:95" --project=chrome    # ✘ falla
   npx playwright test flujo.spec.ts --project=chrome         # ✓ pasa
   ```

   El motivo: la paleta busca en la lista de conversaciones, y **App no vuelve a pedir esa lista después de la primera respuesta** (`useRecurso(obtenerConversaciones)` en `App.tsx:56` solo se recarga al renombrar o borrar). Cuando el test corre detrás de otros, la lista ya trae conversaciones creadas por los tests anteriores en el mismo estado compartido, y la paleta encuentra "teorema" por casualidad. Dos problemas en uno: un test dependiente del orden y un **hueco real de producto**, porque una conversación recién creada no aparece en el historial ni en Cmd+K hasta recargar. El propio `App.tsx` lo reconoce en un comentario (*"una conversacion recien creada todavia no esta en la lista"*), pero lo esquiva en la barra de título en vez de arreglarlo.
2. **axe nunca audita la aplicación.** `RUTAS` en `src/routes.ts` es el mapa del sitio editorial (`/home`, `/arquitectura`, `/tecnologias`...). `/app` vive aparte (`RUTA_APP`, `Raiz.tsx`), así que el chat, el panel de documentos y el visor **no pasan por axe**. Lo he auditado a mano hoy: en `/app` vacío, con el panel de documentos abierto y tras una respuesta, **cero violaciones `serious`/`critical`**. Si quitas el filtro, aparece una `moderate`: `page-has-heading-one` después de una respuesta (la página se queda sin `h1` cuando desaparece la bienvenida). Hoy está bien por suerte, no porque un test lo garantice.
3. **El doble del gateway miente con los argumentos** (sección 2.5). Lo vas a demostrar en el Paso 5: cambias un argumento de una *mutation* por uno que no existe, el gateway real lo rechaza, y **las 126 pruebas unitarias y la e2e siguen en verde**.
4. **No hay ningún test de renombrar.** Ni `TituloEditable` tiene test unitario, ni hay una e2e que renombre (`grep -rn -i renombr pruebas-e2e/*.spec.ts` solo encuentra un fichero llamado `copia-renombrada.pdf`). Y `TituloEditable` tiene justo el tipo de lógica sutil que se rompe sin que nadie lo note: la *ref* `cerrado` que impide guardar dos veces. Es lo que vas a cubrir hoy.
5. **El frontend no corre en CI.** En `.github/workflows/` solo existe `backend.yml`. Las 117 + 86 pruebas solo se ejecutan si alguien lanza `npm run verificar` en su máquina. Es el ejercicio del miércoles.
6. **El README está desactualizado.** La tabla *Estado actual* dice `vitest` 88 y Playwright 59 + 5 saltados. Hoy son 117 y 86 en la lista. (Y `pytest` 91/45, cuando el día 17 contamos 188/66.)
7. **`RUTA_APP` está duplicada.** `flujo.spec.ts` define su propio `const RUTA_APP = '/app'` en vez de importarla de `src/routes.ts`, como sí hace `rutas.spec.ts` con el resto del mapa. Tu e2e de hoy la importa.

---

## 4. Ejercicio (≈40 min)

Objetivo: cubrir *renombrar una conversación* con **un test unitario** (`TituloEditable`) y **una e2e con axe**, romper el código a propósito para ver qué test lo detecta, y demostrar que el doble del gateway miente.

### Paso 0 — Rama y punto de partida (5 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-18 origin/main
cd frontend
npm ci
npx vitest run | tail -4                         # 14 files, 117 tests
npx playwright test --list | tail -1             # Total: 86 tests in 5 files
```

Si nunca has corrido las e2e en esta máquina, el proyecto `chrome` necesita Google Chrome instalado. Para el de iPhone: `npx playwright install webkit`. Hoy basta con `--project=chrome`.

### Paso 1 — El test que depende del orden (3 min)

```bash
npx playwright test "flujo.spec.ts:95" --project=chrome
npx playwright test flujo.spec.ts --project=chrome
```

Anota cuál falla y cuál pasa. Abre `test-results/*/error-context.md` del que falla: Playwright guarda ahí un volcado del árbol de accesibilidad de la página en el momento del fallo. Busca en él `complementary "Conversaciones"`: ¿qué dice la lista?

### Paso 2 — El test unitario de `TituloEditable` (12 min)

Lee primero el componente (`src/features/conversaciones/TituloEditable.tsx`, 62 líneas). Fíjate en la *ref* `cerrado` (líneas 18, 26-27 y 43).

Crea `src/features/conversaciones/TituloEditable.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TituloEditable } from '@/features/conversaciones/TituloEditable';

function montar(titulo = 'Teorema CAP') {
  const onGuardar = vi.fn();
  const onCancelar = vi.fn();
  render(
    <>
      <TituloEditable titulo={titulo} onGuardar={onGuardar} onCancelar={onCancelar} />
      {/* Algo a lo que mandar el foco, para provocar el blur con Tab. */}
      <button type="button">fuera</button>
    </>,
  );
  const campo = screen.getByRole('textbox', { name: /nuevo título de la conversación/i });
  return { onGuardar, onCancelar, campo };
}

describe('TituloEditable', () => {
  it('nace con el foco y el texto seleccionado', () => {
    const { campo } = montar();
    expect(campo).toHaveFocus();
    expect(campo).toHaveValue('Teorema CAP');
    const input = campo as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Teorema CAP'.length]);
  });

  it('Enter guarda el texto recortado', async () => {
    const usuario = userEvent.setup();
    const { onGuardar, onCancelar } = montar();

    // Como nace seleccionado, escribir sustituye el título entero.
    await usuario.keyboard('  Replicación  {Enter}');

    expect(onGuardar).toHaveBeenCalledExactlyOnceWith('Replicación');
    expect(onCancelar).not.toHaveBeenCalled();
  });

  it('Enter y luego perder el foco guarda UNA sola vez', async () => {
    const usuario = userEvent.setup();
    const { onGuardar } = montar();

    await usuario.keyboard('Replicación{Enter}');
    await usuario.tab(); // blur: vuelve a llamar a guardar()

    expect(onGuardar).toHaveBeenCalledTimes(1);
  });

  it('perder el foco también guarda', async () => {
    const usuario = userEvent.setup();
    const { onGuardar } = montar();

    await usuario.keyboard('Replicación');
    await usuario.tab();

    expect(onGuardar).toHaveBeenCalledExactlyOnceWith('Replicación');
  });

  it('Escape cancela, y el blur posterior no guarda', async () => {
    const usuario = userEvent.setup();
    const { onGuardar, onCancelar } = montar();

    await usuario.keyboard('Replicación{Escape}');
    await usuario.tab();

    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it.each([
    ['vacío', '{Backspace}'],
    ['solo espacios', '   '],
    ['el mismo título', 'Teorema CAP'],
    ['el mismo título con espacios', '  Teorema CAP '],
  ])('%s: cancela en vez de guardar', async (_caso, teclas) => {
    const usuario = userEvent.setup();
    const { onGuardar, onCancelar } = montar();

    await usuario.keyboard(`${teclas}{Enter}`);

    expect(onGuardar).not.toHaveBeenCalled();
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });
});
```

```bash
npx vitest run src/features/conversaciones
```

Deben salir **9 tests** en verde: 5 `it` normales y 4 casos del `it.each`.

Detalles que tienes que entender, no copiar:

- El `<button>fuera</button>` existe para que `usuario.tab()` tenga adónde llevar el foco. Sin él, el foco sale a `body` igualmente, pero así el test dice lo que hace.
- `usuario.keyboard(...)` escribe **en el elemento que tiene el foco**. Funciona sin hacer `click` porque el componente se enfoca solo al montarse (`useEffect` con `focus()` y `select()`). Si alguien quitara ese `useEffect`, fallaría casi toda la suite a la vez, no solo el primer test. ¿Es eso bueno o malo?
- `{Backspace}` borra el texto seleccionado entero, porque nace seleccionado.

### Paso 3 — Romper a propósito (4 min)

Comenta la primera línea de `guardar()`:

```bash
sed -i 's/    if (cerrado.current) return;/    \/\/ if (cerrado.current) return;/' src/features/conversaciones/TituloEditable.tsx
npx vitest run src/features/conversaciones
git checkout src/features/conversaciones/TituloEditable.tsx
```

Salida que he obtenido:

```text
     × Enter y luego perder el foco guarda UNA sola vez
     × Escape cancela, y el blur posterior no guarda
      Tests  2 failed | 7 passed (9)
```

Explica en la entrega por qué falla **el de Escape**, si Escape ni siquiera llama a `guardar()`.

### Paso 4 — La e2e: renombrar, recargar y pasar axe (12 min)

Crea `pruebas-e2e/conversaciones.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { RUTA_APP } from '../src/routes';

/** Hace una pregunta y espera a la respuesta RENDERIZADA (ver flujo.spec.ts). */
async function preguntar(page: Page, texto: string) {
  const campo = page.getByLabel(/escribe tu pregunta/i);
  await campo.fill(texto);
  await campo.press('Enter');
  await expect(
    page
      .getByLabel('Respuesta del agente')
      .getByRole('heading', { name: 'El teorema CAP' }),
  ).toBeVisible();
}

test('renombrar una conversación desde el historial, y que dure al recargar', async ({
  page,
}) => {
  // En móvil el historial es un cajón: este recorrido se valida en escritorio.
  test.skip(
    (page.viewportSize()?.width ?? 1440) < 768,
    'el historial lateral solo está fijo en escritorio',
  );
  // El estado del servidor falso se comparte entre TODAS las pruebas del
  // proyecto: un título único evita confundir este hilo con el de otra.
  const pregunta = `CAP ${test.info().testId} ${Date.now()}`;
  const nuevo = `Apuntes ${pregunta}`;

  await page.goto(RUTA_APP);
  await preguntar(page, pregunta);

  // Un hilo recién creado no entra en el historial hasta recargar: App no
  // vuelve a pedir la lista al terminar la primera respuesta.
  await page.reload();

  const historial = page.getByRole('complementary', { name: 'Conversaciones' });
  await historial
    .getByRole('button', { name: `Renombrar la conversación ${pregunta}` })
    .click();

  const campo = historial.getByRole('textbox', {
    name: 'Nuevo título de la conversación',
  });
  await expect(campo).toBeFocused();
  await campo.fill(nuevo);
  await campo.press('Enter');

  // El aviso sale dos veces: el toast que se ve y la región `aria-live` que
  // oye un lector de pantalla. Se comprueba la segunda: es la que tiene rol.
  await expect(
    page.getByRole('status').filter({ hasText: 'Conversación renombrada.' }),
  ).toBeAttached();
  await expect(campo).toHaveCount(0);
  // La fila lleva el título en `title`; su nombre accesible incluye además la hora.
  await expect(historial.getByTitle(nuevo, { exact: true })).toBeVisible();

  // El título vive en el servidor, no en el estado de React.
  await page.reload();
  await expect(historial.getByTitle(nuevo, { exact: true })).toBeVisible();

  // Y con el campo de edición abierto, la página sigue siendo accesible.
  await historial
    .getByRole('button', { name: `Renombrar la conversación ${nuevo}` })
    .click();
  await expect(campo).toBeFocused();

  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const graves = violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(graves.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
});
```

```bash
npx eslint pruebas-e2e/conversaciones.spec.ts
npx prettier --check pruebas-e2e src/features/conversaciones
npx tsc -b
npx playwright test conversaciones --project=chrome
```

Tiene que pasar **ejecutándose sola**, que es justo lo que no hace `flujo.spec.ts:95`. Por eso lleva el `page.reload()` después de preguntar y un título único.

Lo que me pasó escribiéndolo, para que lo reconozcas si te pasa:

- Sin el primer `reload()`, el botón *Renombrar* no aparece nunca: el historial dice *"Todavía no hay conversaciones"*. Es el hueco de la sección 3.
- Con `page.getByText('Conversación renombrada.')`, **strict mode violation**: el texto está dos veces, en el *toast* visible y en la región `aria-live` de `src/shared/ui/Anuncios.tsx`, que solo oye un lector de pantalla. Por eso el test busca `getByRole('status')`.
- Con `getByRole('button', { name: nuevo })`, otra *strict mode violation* con 3 elementos: por defecto `name` busca **subcadenas**, y los botones *Renombrar la conversación ...* y *Borrar la conversación ...* también contienen el título. Además, el nombre accesible de la fila incluye la hora. Por eso uso `getByTitle(nuevo, { exact: true })`.

### Paso 5 — El doble que miente (4 min)

Cambia el argumento `titulo` de la *mutation* por uno que no existe en el gateway:

```bash
sed -i 's/renombrar_conversacion(id: $id, titulo: $titulo)/renombrar_conversacion(id: $id, nombre: $titulo)/' src/shared/api/conversaciones.ts
npx vitest run | tail -3
npx playwright test conversaciones --project=chrome
```

Las dos cosas siguen en verde (126 tests y la e2e). Ahora pregúntale al gateway de verdad, sin levantar nada:

```bash
cd ../gateway
uv run python -c "
from app.schema import schema
q='mutation(\$id: Int!, \$titulo: String!) { renombrar_conversacion(id: \$id, nombre: \$titulo) { id titulo } }'
r = schema.execute_sync(q, variable_values={'id': 1, 'titulo': 'x'}, context_value={})
print([e.message for e in r.errors])
"
cd ../frontend
git checkout src/shared/api/conversaciones.ts
```

Salida real:

```text
["Unknown argument 'nombre' on field 'Mutation.renombrar_conversacion'.", "Argument 'Mutation.renombrar_conversacion(titulo:)' of type 'String!' is required, but it was not provided."]
```

En producción, renombrar dejaría de funcionar y ninguna prueba del frontend, ni unitaria ni e2e, lo vería.

### Paso 6 — Commit (2 min)

```bash
npx vitest run | tail -3                                  # 15 files, 126 tests
npx playwright test --project=chrome | tail -3            # 43 passed, 1 skipped
git status --short                                        # solo los dos ficheros nuevos
git add src/features/conversaciones/TituloEditable.test.tsx pruebas-e2e/conversaciones.spec.ts
git commit -m "test(frontend): TituloEditable y e2e de renombrar con axe"
git push -u origin ejercicio/dia-18
```

### Bonus (opcional, si te sobran 15 min)

El gateway puede imprimir su esquema completo en SDL:

```bash
cd ../gateway && uv run python -c "from app.schema import schema; print(schema.as_str())" > /tmp/esquema.graphql && wc -l /tmp/esquema.graphql
```

Piensa (no hace falta implementarlo) cómo convertirías ese fichero en un test del frontend que valide **cada** *query* y *mutation* de `src/shared/api/*.ts` contra el esquema real. Pista: el paquete `graphql` de npm tiene `buildSchema`, `parse` y `validate`. ¿Dónde se generaría el SDL y cómo te enterarías de que se ha quedado viejo? Lo retomamos el miércoles con el CI.

### Preguntas (respóndelas con tus palabras en la entrega)

1. ¿Por qué falla `flujo.spec.ts:95` cuando corre solo? ¿Es un problema del test, del producto o de los dos? ¿Cómo lo arreglarías en cada sitio?
2. En el Paso 3, ¿por qué falla el test de Escape? ¿Qué evento llama a `guardar()` y por qué `cerrado` lo frena?
3. ¿Qué diferencia hay entre `fireEvent.keyDown(campo, { key: 'Enter' })` y `usuario.keyboard('{Enter}')`? ¿Habría pillado `fireEvent` el fallo del Paso 3 en el test de *Enter y luego perder el foco*?
4. El parche de `<dialog>` en `preparar.ts` no captura el foco. ¿Qué parte del comportamiento del `Drawer` no puedes probar con Vitest, y dónde la probarías?
5. Tras el Paso 5: ¿cuál es exactamente la mentira del servidor falso? Explica los dos puntos, argumentos y campos, con una línea de `servidor-falso.mjs` cada uno.
6. axe pasa en `/app` hoy. ¿Por qué eso no basta, y qué cambiarías para que `rutas.spec.ts` también audite la aplicación?

### Criterios de aceptación

- [ ] Existe la rama `ejercicio/dia-18` en el remoto, creada desde `main`, con **solo** los dos ficheros nuevos.
- [ ] `npx vitest run` da 15 ficheros y 126 tests en verde.
- [ ] `npx playwright test conversaciones --project=chrome` pasa **ejecutado solo**.
- [ ] `npx eslint pruebas-e2e`, `npx prettier --check .` y `npx tsc -b` salen limpios.
- [ ] La entrega incluye la salida del Paso 1 (las dos ejecuciones) y la del Paso 3.
- [ ] La entrega incluye la salida del Paso 5 en las dos partes: el frontend en verde y el gateway rechazando la *mutation*.
- [ ] Las 6 preguntas están respondidas con tus palabras.
- [ ] El párrafo para `ARCHITECTURE.md` está en la entrega.

### Entrega: antes de las 8:30 del miércoles 25-nov

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-18.md
# ...rellénala...
git add docs/aprendizaje/entregas/dia-18.md
git commit -m "entrega día 18" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code (con `XX` = `18`) estando en tu rama `ejercicio/dia-18`.

---

## 5. Para profundizar (opcional)

- Testing Library, *About Queries* (el orden de prioridad de las consultas: rol, etiqueta, texto... y `data-testid` el último): <https://testing-library.com/docs/queries/about>
- Playwright, *Best Practices* (locators, aserciones web-first, aislamiento entre tests): <https://playwright.dev/docs/best-practices>

---

## 6. Aportación a `ARCHITECTURE.md`

Hoy sigues en la sección *12. Testing y evaluación (días 17, 18 y 20)*. Tu párrafo del frontend debería cubrir:

- Los dos niveles por **lo que es real** en cada uno: Vitest + Testing Library en jsdom (el árbol de React, sin pintado) y Playwright contra el *build* de producción (el navegador entero, sin backend).
- Qué parchea `preparar.ts` y lo que eso implica: lo modal y lo visual solo se prueba en Playwright.
- El servidor falso como único doble del gateway: estado partido por proyecto y no por test (y el test dependiente del orden que lo demuestra), y el acoplamiento a las variables del cliente en vez de al esquema real.
- axe generado desde `src/routes.ts` y el hueco de `/app`.
- Que nada de esto corre en CI todavía.

**El miércoles 25-nov (día 19):** CI, linters y Docker multiservicio. Leeremos `.github/workflows/backend.yml` línea a línea, todos los linters del repo (ruff, mypy, oxlint, ESLint, Prettier, knip) y qué vigila cada uno, y el ejercicio será el que falta desde hoy: añadir al CI los jobs del gateway y del frontend, incluidas las pruebas que has escrito hoy.
