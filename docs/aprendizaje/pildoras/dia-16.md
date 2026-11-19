# Píldora 16 — El shell, el sistema de UI y la paleta de comandos

**Jueves 19-nov-2026 · sesión corta: 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 15

No hay entrega del día 15: en `origin/aprendizaje` no existe `entregas/dia-15.md` y en el remoto no hay ninguna rama `ejercicio/dia-*`. Tampoco ha llegado tarde ninguna anterior. Sin nota.

El ejercicio del 15 (llevar `size` de SQLite a la cola) sigue valiendo tal cual: `main` no se ha movido desde `#45` (`2cf91a8`, 16-nov). El de hoy enlaza con uno de sus 🟠: la lista de conversaciones y la de documentos no se recargan solas. Hoy no lo arreglas, pero sí le das al usuario una salida desde la paleta.

Todo lo que cuento está comprobado hoy contra `2cf91a8`. `npx vitest run` da **14 ficheros y 117 tests** en verde. He hecho el ejercicio entero en una copia limpia antes de escribirlo, y las salidas que pego son reales. Además he levantado la app contra el servidor falso de las e2e y la he recorrido con Playwright en escritorio y en móvil, que es de donde salen dos de las "cosas que no cuadran".

---

## 1. Concepto clave: un layout que no sabe nada del dominio

### 1.1 El shell como componente con huecos

Un *shell* (o *layout*) es el esqueleto fijo de una aplicación: barra, columnas y paneles. La pregunta de diseño es **quién conoce a quién**. Hay dos formas de montarlo:

- **El shell importa sus piezas.** `AppShell` hace `import { ListaConversaciones }` y la pinta. Es más corto, pero el shell queda atado al dominio: para probarlo necesitas el chat, la API y los datos.
- **El shell recibe huecos (*slots*).** `AppShell` declara `lateral`, `fuentes` y `documentos` como `ReactNode`, y quien lo usa decide qué va dentro. El shell solo sabe **dónde** y **cómo** se colocan las cosas.

AGENT4U usa la segunda. Es la misma idea que `children`, pero con varios huecos con nombre.

### 1.2 Pedirle cosas a un hijo: props frente a `ref`

En React los datos bajan por props. Pero "abre el panel de fuentes" no es un dato: es **una orden puntual**. Si la modelas como prop (`fuentesAbiertas={true}`), el padre pasa a ser dueño de un estado que en realidad es del shell, y además tendrías que observar la prop con un efecto para reaccionar al cambio. `useImperativeHandle` permite que un componente exponga **métodos** por `ref`, igual que un `<input>` expone `.focus()`. Es una vía de escape que la documentación de React recomienda usar poco, y aquí está justificada.

### 1.3 `<dialog>` nativo

`dialog.showModal()` te da gratis cuatro cosas que, hechas a mano, son la fuente clásica de bugs de accesibilidad:

- El **foco atrapado** dentro del diálogo.
- **Escape** para cerrar.
- El fondo `::backdrop`.
- **El resto de la página inerte**: ni se tabula ni la lee un lector de pantalla.

Además, los modales viven en la *top layer* del navegador, por encima de cualquier `z-index`.

### 1.4 El patrón *combobox* con `aria-activedescendant`

En una paleta, el foco **se queda en el campo de texto** mientras las flechas mueven la selección por la lista. El lector de pantalla se entera de qué opción está marcada porque el `<input>` lleva `aria-activedescendant="<id de la opción>"`. Es un contrato: **el índice que mueves con las flechas, el `id` que anuncias y la opción que pintas como marcada tienen que ser la misma**. Hoy verás qué pasa cuando no lo son.

---

## 2. Cómo está en AGENT4U

### 2.1 El mapa

```text
frontend/src/
  app/App.tsx                        360 l.  dueño del estado; monta AppShell, PaletaComandos, Toasts y Anuncios
  app/AppShell.tsx                   333 l.  barra + 3 zonas; columnas en escritorio, <dialog> en móvil
  features/comandos/
    comandos.ts                       51 l.  tipo Comando, filtrarComandos, agruparComandos (puros)
    PaletaComandos.tsx               205 l.  <dialog> + combobox + listbox
  shared/hooks/useAtajo.ts            52 l.  atajos globales (Cmd/Ctrl+K)
  shared/ui/                                 12 componentes + clases.ts + index.ts
    Button, IconButton, Badge, Input, Skeleton, Spinner   ← los 6 del barril index.ts
    Drawer, Toasts, Anuncios, Tooltip, Logo, Animacion    ← se importan por ruta
  shared/styles/tokens.css           248 l.  colores por ROL, temas y @theme inline
```

### 2.2 `AppShell`: huecos, columnas y modales

Las props (`AppShell.tsx:21-36`) son todas `ReactNode`: `lateral`, `children` (el chat), `fuentes`, `documentos`, `titulo`, `indicador` y `acciones`. El comentario de las l. 58-69 lo dice claro: *"el shell no sabe nada del dominio y se puede mirar y probar solo"*.

Lo interesante es cómo cambia según la anchura. `useMediaQuery(CONSULTA_ESCRITORIO)` (`'(min-width: 1024px)'`) decide entre dos árboles **distintos a propósito**:

```text
                    escritorio (≥1024px)                     compacto (<1024px)
conversaciones      <m.aside order-1>, animada por ancho     <Drawer lado="inicio">
chat                <main order-2>                           <main order-2>
fuentes             <m.aside order-3>                        <Drawer lado="abajo">   (hoja inferior)
documentos          <Drawer lado="fin">  en las dos medidas
```

Hay tres detalles que merece la pena retener:

- **El chat va primero en el DOM** (`AppShell.tsx:246-257`) aunque se vea en el centro. El orden de tabulación sigue al documento, y `order-*` de flexbox lo recoloca visualmente. Lo primero que encuentra el tabulador, después de los enlaces de salto (l. 124-137), es el campo de escribir.
- **Dos estados por panel**: `lateralVisible` (columna plegada o desplegada en escritorio) y `lateralAbierto` (modal abierto en móvil). No es duplicación: son dos conceptos distintos, con semántica ARIA distinta. Por eso el `IconButton` de fuentes lleva `aria-pressed` solo en escritorio (l. 226-242).
- **`ControlesShell`** (l. 39-52) expone `abrirFuentes`, `abrirLateral`, `abrirDocumentos` y `cerrarPaneles` con `useImperativeHandle` (l. 91-110). El comentario de las l. 87-90 da el porqué: con una prop habría que mirarla desde un efecto, que es el render en cascada que desaconseja `react/set-state-in-effect`. `cerrarPaneles` existe porque el visor de documentos (día 14) tiene que ganar a cualquier `<dialog>` modal, y eso solo se consigue cerrándolos.

En `App.tsx` lo ves usado: `const shell = useRef<ControlesShell>(null)` (l. 71), `elegirCita` llama a `shell.current?.abrirFuentes()` (l. 103) y `abrirDocumento` a `shell.current?.cerrarPaneles()` antes de navegar (l. 117).

### 2.3 `shared/ui`: un sistema pequeño y con opinión

No hay librería de componentes. Son 12 ficheros cortos, y cada uno lleva su decisión escrita:

- **`Button`** (64 l.) tiene tres variantes, y el comentario de las l. 20-28 es la regla del sistema: `primario` es *"la UNICA pieza rellena de la pantalla"*. Por eso el botón *Nueva conversación* de la columna es `secundario` (`App.tsx:265-284` lo justifica). Alturas en `rem` que no encogen con la densidad (l. 35-36).
- **`IconButton`** (48 l.) hace **obligatoria** la `etiqueta` (l. 7), que acaba en `aria-label`. Un botón con solo un icono sin nombre accesible es invisible para un lector de pantalla, y aquí el tipo no te deja olvidarlo. Mide 32 px (`size-8`), por debajo de los 44 px táctiles, y el comentario lo asume (l. 12-16). Ojo: dice "28px de caja", pero `size-8` son 32 px. Es un comentario viejo.
- **`Drawer`** (89 l.) es el `<dialog>` nativo del §1.3. El efecto de las l. 46-52 sincroniza `abierto` con `showModal()`/`close()`. El de las l. 58-65 escucha el evento `close` **en el DOM** porque Escape cierra el diálogo sin pasar por React, y si el padre no se entera, se queda creyendo que sigue abierto y el botón ya no vuelve a abrirlo nunca.
- **`Toasts` + `Anuncios`.** Los toasts son `aria-hidden` (`Toasts.tsx:22`) y el texto llega al lector por **una sola** región `role="status" aria-live="polite"` que existe siempre, vacía (`Anuncios.tsx`). En `App.tsx:85-91`, `notificar` llama a los dos a la vez para que ningún mensaje llegue solo a la mitad de los usuarios.
- **`clases()`** (`clases.ts`, 4 líneas) es un `clsx` casero: une cadenas e ignora `false`/`undefined`.
- **Los colores no son colores, son roles.** `bg-superficie`, `text-suave` o `border-borde` salen de `shared/styles/tokens.css`: los valores crudos viven en `:root` y se redefinen por tema, y `@theme inline` (l. 24) los convierte en utilidades de Tailwind. El `inline` hace que la utilidad apunte a la variable en vez de copiar su valor, y por eso el cambio de tema se propaga en caliente.

### 2.4 La paleta de comandos

Tiene tres capas bien separadas:

**1. El modelo y la lógica pura** (`comandos.ts`). Un `Comando` es `{ id, titulo, detalle?, grupo, alias?, ejecutar }`. `filtrarComandos` (l. 26-36) normaliza (minúsculas y sin acentos, l. 14-16) y exige que **cada palabra** aparezca en título, detalle o alias. Es búsqueda por subcadena, no difusa, y el comentario de las l. 21-24 explica por qué: con pocas opciones, lo difuso devuelve cosas que el usuario no entiende. `agruparComandos` (l. 39-51) reparte por `grupo` conservando el orden de primera aparición.

**2. La vista** (`PaletaComandos.tsx`). Es un `<dialog>` con el mismo patrón que `Drawer` (l. 19-34), anclado arriba (`top-[12vh]`). El contenido solo existe mientras está abierta (l. 47-53), así que la búsqueda y la opción activa **nacen limpias en cada apertura** sin un efecto que las resetee. Dentro:

```tsx
// PaletaComandos.tsx:69-70
const visibles = useMemo(() => filtrarComandos(comandos, texto), [comandos, texto]);
const grupos = useMemo(() => agruparComandos(visibles), [visibles]);
```

- El `<input>` es `role="combobox"` y apunta con `aria-activedescendant` a `comando-${visibles[activo].id}` (l. 113-120).
- Las flechas recorren `visibles` con módulo, para dar la vuelta por los dos extremos (l. 93).
- Enter ejecuta `visibles[activo]` (l. 96-99).
- Al pintar, un contador `posicion` recorre **los grupos** (l. 103 y 143-144) y marca como seleccionada la opción cuyo índice coincide con `activo`.
- El ratón **mueve** la selección (`onMouseMove`, l. 159) en vez de tener su propio resalte, para que solo haya una cosa marcada.
- `ejecutar` cierra primero y ejecuta después (l. 80-84): si no, la paleta taparía lo que acaba de hacer.

**3. Quién la alimenta** (`App.tsx`):

- `useAtajo({ tecla: 'k', conModificador: true }, abrirPaleta)` (l. 149). Con modificador también funciona dentro de un campo de texto (`useAtajo.ts:27`), porque Cmd+K no se teclea por accidente.
- `abrirPaleta` no hace nada con el visor abierto (l. 109-113).
- La lista de comandos se construye **en línea**, dentro de un `useMemo` de 58 líneas (l. 181-238): cuatro acciones fijas, tres temas y **un comando por conversación**. El comentario de las l. 228-229 lo resume: buscar una conversación y abrirla *es* ejecutar una acción. Por eso la paleta es a la vez lanzador y buscador del historial.

Hay dos formas de abrirla: Cmd/Ctrl+K y el botón *Buscar…* de la columna lateral (`App.tsx:286-293`).

---

## 3. Por qué se montó así

**Huecos en vez de imports.** El shell cambió de forma varias veces (`#35` *navegación*, 19-oct; `#44` *visor*, 13-nov) sin tocar los componentes de dominio, y al revés. El coste es que `App.tsx` se ha convertido en el sitio donde se conecta todo: 360 líneas, 11 `useCallback`, 2 `useMemo` y otros 16 hooks, y toda la orquestación. Es el "componente Dios" típico del patrón. Hoy le vas a quitar un trozo.

**`ref` imperativa en vez de estado elevado.** Abrir un panel es un evento, no un estado que se sincroniza. El coste es que las órdenes no pasan por el flujo de datos de React: no se ven en las props, no se testean con un `render` normal y, como verás en el ejercicio, el linter desconfía de ellas.

**`<dialog>` nativo en vez de una librería (Radix, Headless UI).** Cero dependencias, y foco, Escape e inercia los resuelve el navegador. El coste es el puente con React: hay que sincronizar `abierto` con `showModal()` en un efecto y escuchar `close` a mano. Ese puente está **copiado** en `Drawer.tsx:46-65` y `PaletaComandos.tsx:19-34`, con un comentario casi idéntico. Un `useDialogoModal(abierto, alCerrar)` lo dejaría en un sitio.

**Paleta de comandos propia en vez de `cmdk`.** Son unas 250 líneas en total, con tests, y hacen exactamente lo que hace falta. El coste son los detalles finos de accesibilidad que una librería ya trae resueltos… y uno de ellos está roto (ver abajo).

**Subcadena en vez de *fuzzy*.** Con unas decenas de comandos, la predictibilidad gana a la tolerancia a erratas. Con 500 conversaciones en el historial, quizá no.

### Cosas que no cuadran

- 🟠 **La selección y la ejecución se pueden desalinear.** `visibles` está en el orden del filtro, pero se pinta en el orden de los grupos. Si un grupo llega partido (por ejemplo `A:Acciones, B:Ir a, C:Acciones`), en pantalla sale `A, C | B`. Lo he comprobado con un test: con una flecha abajo, **la opción marcada es C**, `aria-activedescendant` dice **`comando-b`** y **Enter ejecuta B**. Hoy no se ve porque `App.tsx` mete los grupos contiguos, pero es una condición que no está escrita en ningún sitio: basta con añadir un comando de *Acciones* al final de la lista para que la paleta ejecute una cosa distinta de la que enseña. El bonus de hoy lo arregla.
- 🟠 **En móvil, abrir una conversación no cierra el panel de conversaciones.** Lo he reproducido en un Pixel 5 emulado: pulsas una fila del `Drawer` lateral y, tras abrirse el hilo, `dialog[open]` sigue siendo `['Conversaciones']`. El chat que acabas de abrir queda debajo del modal. `abrirHilo` (`App.tsx:151-156`) no llama a `cerrarPaneles`, y ninguna e2e cubre ese recorrido en el proyecto `iphone`.
- 🟡 **La e2e de la paleta se salta en móvil por una razón que ya no es verdad.** `flujo.spec.ts:98-103` dice *"en un movil no hay recorrido que validar, porque no hay forma de invocarla"*. La hay: el botón *Buscar…* de la columna lateral, que en móvil vive dentro del `Drawer`. Lo he comprobado: se abre, y además se apila sobre el `Drawer`. Tras *Ir a documentos* quedan **dos** modales abiertos, `['Conversaciones', 'Documentos']`, y al cerrar el de documentos vuelves al de conversaciones.
- 🟡 **El `useMemo` de los comandos no memoriza nada.** Depende de `conversacion` y de `preferencias` (`App.tsx:238`), y `useConversacion` devuelve un objeto literal nuevo en cada render (`useConversacion.ts:269`), igual que `usePreferencias`. Mientras llega una respuesta por SSE, **cada token** reconstruye la lista entera de comandos. Es el mismo problema que el `resolverDocumento` del día 15.
- 🟡 **Hay dos fuentes para el símbolo del atajo.** `ATAJO_PALETA` (`App.tsx:36-40`) y `TECLA_MODIFICADORA` (`useAtajo.ts:48-52`) son la misma detección copiada. Además, las dos usan `navigator.platform`, que está obsoleta.
- 🟡 **Comentarios que describen otro diseño:**
  - `AppShell.tsx:139` dice *"Cabecera fina: 48px. Translucida"*, y la cabecera es `h-16` (64 px) con `bg-fondo` opaco.
  - `tema.ts:12-16` habla del tema claro *"crema"* y del oscuro *"tinta tostada"*, pero `tokens.css` es blanco puro y negro puro (*"ningun color de marca"*, l. 17-21). El propio `tokens.css` presume de que la identidad cambió cuatro veces sin tocar componentes, y los comentarios no siguieron el cambio.
  - `IconButton` dice "28px", y `size-8` son 32 px.
- 🟡 **El barril `shared/ui/index.ts` está a medias.** Exporta 6 de los 12 componentes. Las *features* importan de `@/shared/ui` y `app/` importa por ruta (`@/shared/ui/IconButton`). No rompe nada, pero no hay regla.
- 🟡 **`agruparComandos` pierde el tipo:** devuelve `grupo: string` cuando el tipo de origen es una unión cerrada de cuatro valores.

---

## 4. Ejercicio (~40 min)

Rama `ejercicio/dia-16` desde `main`. Objetivo: **añadir un comando nuevo a la paleta**, *Actualizar documentos y conversaciones*, y de paso sacar la lista de comandos de `App.tsx` a una **función pura testeable**. Hoy esa lista no tiene un solo test: vive dentro de un `useMemo` y para probarla habría que montar `App` entera.

### Paso 1 — Rama y línea base (3 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-16 origin/main
cd frontend
npm ci
npx vitest run          # esperado: Test Files 14 passed · Tests 117 passed
```

### Paso 2 — El test primero (7 min)

En `src/features/comandos/comandos.test.ts`:

- Cambia la primera línea a `import { describe, expect, it, vi } from 'vitest';`.
- Añade `crearComandos,` al `import` de `@/features/comandos/comandos`, entre `agruparComandos` y `filtrarComandos`.
- Pega esto al final del fichero:

```ts
describe('crearComandos', () => {
  function acciones() {
    return {
      nueva: vi.fn(),
      abrirDocumentos: vi.fn(),
      abrirFuentes: vi.fn(),
      abrirAjustes: vi.fn(),
      elegirTema: vi.fn(),
      recargar: vi.fn(),
      abrirHilo: vi.fn(),
    };
  }

  const hilos = [
    {
      id: 7,
      titulo: 'Teorema CAP',
      creada_en: '',
      actualizada_en: '2026-11-18T10:00:00Z',
    },
  ];

  it('lista las acciones fijas, los tres temas y un comando por hilo', () => {
    const comandos = crearComandos(acciones(), hilos);
    expect(comandos.map((x) => x.id)).toEqual([
      'nueva',
      'recargar',
      'documentos',
      'fuentes',
      'ajustes',
      'tema-sistema',
      'tema-claro',
      'tema-oscuro',
      'hilo-7',
    ]);
  });

  it('«refrescar» encuentra el comando de actualizar y lo ejecuta', () => {
    const a = acciones();
    const [comando] = filtrarComandos(crearComandos(a, []), 'refrescar');
    expect(comando?.id).toBe('recargar');
    comando?.ejecutar();
    expect(a.recargar).toHaveBeenCalledOnce();
  });

  it('cada hilo abre su conversación y cada tema elige el suyo', () => {
    const a = acciones();
    const comandos = crearComandos(a, hilos);
    comandos.find((x) => x.id === 'hilo-7')?.ejecutar();
    comandos.find((x) => x.id === 'tema-oscuro')?.ejecutar();
    expect(a.abrirHilo).toHaveBeenCalledWith(7);
    expect(a.elegirTema).toHaveBeenCalledWith('oscuro');
  });
});
```

```bash
npx vitest run src/features/comandos/comandos.test.ts
```

Esperado (es lo que obtuve yo):

```text
TypeError: crearComandos is not a function
      Tests  3 failed | 8 passed (11)
```

**Pega esta salida en la entrega.**

### Paso 3 — `crearComandos` en `comandos.ts` (8 min)

Al **principio** de `src/features/comandos/comandos.ts` añade los imports:

```ts
import type { ConversacionResumen } from '@/shared/api/types';
import { formatearFecha } from '@/shared/lib/fechas';
import { NOMBRE_TEMA, type Tema } from '@/shared/lib/tema';

```

Y al **final** del fichero, después de `agruparComandos`:

```ts
/** Lo que la paleta sabe hacer. Cada accion la pone App; aqui solo se describe. */
type AccionesPaleta = {
  nueva: () => void;
  abrirDocumentos: () => void;
  abrirFuentes: () => void;
  abrirAjustes: () => void;
  elegirTema: (tema: Tema) => void;
  recargar: () => void;
  abrirHilo: (id: number) => void;
};

/**
 * La lista completa de la paleta, como funcion pura: recibe las acciones y el
 * historial y devuelve los comandos. Fuera de App se puede probar sin montar
 * el shell, el chat ni el router.
 */
export function crearComandos(
  acciones: AccionesPaleta,
  hilos: ConversacionResumen[],
): Comando[] {
  return [
    {
      id: 'nueva',
      titulo: 'Nueva conversación',
      detalle: 'Vacía el chat para empezar de cero',
      grupo: 'Acciones',
      alias: ['empezar', 'limpiar', 'reset'],
      ejecutar: acciones.nueva,
    },
    // Justo detras de 'nueva': los grupos tienen que llegar contiguos (ver
    // la pildora 16, "cosas que no cuadran").
    {
      id: 'recargar',
      titulo: 'Actualizar documentos y conversaciones',
      detalle: 'Vuelve a pedir las dos listas al servidor',
      grupo: 'Acciones',
      alias: ['refrescar', 'recargar', 'sincronizar', 'f5'],
      ejecutar: acciones.recargar,
    },
    {
      id: 'documentos',
      titulo: 'Ir a documentos',
      detalle: 'Indexar o borrar documentos',
      grupo: 'Ir a',
      alias: ['indexar', 'subir', 'ficheros', 'pdf'],
      ejecutar: acciones.abrirDocumentos,
    },
    {
      id: 'fuentes',
      titulo: 'Ver las fuentes',
      detalle: 'Abre el panel de la derecha',
      grupo: 'Ir a',
      alias: ['citas', 'referencias'],
      ejecutar: acciones.abrirFuentes,
    },
    {
      id: 'ajustes',
      titulo: 'Abrir ajustes',
      detalle: 'Tema, densidad y parámetros de consulta',
      grupo: 'Ir a',
      alias: ['preferencias', 'opciones', 'config'],
      ejecutar: acciones.abrirAjustes,
    },
    ...(['sistema', 'claro', 'oscuro'] as const).map((tema) => ({
      id: `tema-${tema}`,
      titulo: `Tema: ${NOMBRE_TEMA[tema].toLowerCase()}`,
      grupo: 'Apariencia' as const,
      alias: ['aspecto', 'modo', 'color'],
      ejecutar: () => acciones.elegirTema(tema),
    })),
    // El historial entra como comandos: buscar una conversación y abrirla es
    // lo mismo que ejecutar una acción, y así se filtra con el mismo campo.
    ...hilos.map((hilo) => ({
      id: `hilo-${hilo.id}`,
      titulo: hilo.titulo,
      detalle: formatearFecha(hilo.actualizada_en),
      grupo: 'Conversaciones' as const,
      ejecutar: () => acciones.abrirHilo(hilo.id),
    })),
  ];
}
```

```bash
npx vitest run src/features/comandos/comandos.test.ts    # esperado: Tests 11 passed (11)
```

### Paso 4 — Conectarlo en `App.tsx` (10 min)

**4.1 · Imports.** Cambia `import type { Comando } from '@/features/comandos/comandos';` por:

```ts
import { crearComandos, type Comando } from '@/features/comandos/comandos';
```

Y **borra** la línea `import { formatearFecha } from '@/shared/lib/fechas';`, que ya no se usa aquí. No toques el import de `NOMBRE_TEMA`, porque lo sigue usando el botón de tema de la cabecera.

**4.2 · Un callback estable para las fuentes.** Debajo de `const verDocumentos = useCallback(...)` (l. 106):

```ts
  const verFuentes = useCallback(() => shell.current?.abrirFuentes(), []);
```

**4.3 · La lista.** Sustituye el bloque entero desde `const comandos = useMemo<Comando[]>(() => {` (l. 181) hasta su cierre `}, [conversaciones.estado, conversacion, preferencias, abrirHilo, anunciar]);` (l. 238) por:

```tsx
  // Sacadas del objeto: `useRecurso` devuelve uno nuevo en cada render, pero
  // su `reintentar` es estable.
  const { reintentar: recargarDocumentos } = documentos;
  const { reintentar: recargarConversaciones } = conversaciones;

  const comandos = useMemo<Comando[]>(() => {
    const hilos =
      conversaciones.estado.fase === 'listo' ? conversaciones.estado.datos : [];

    return crearComandos(
      {
        nueva: () => {
          conversacion.nueva();
          anunciar('Conversación nueva. El chat está vacío.');
        },
        abrirDocumentos: verDocumentos,
        abrirFuentes: verFuentes,
        abrirAjustes: () => setAjustesAbiertos(true),
        elegirTema: preferencias.elegirTema,
        recargar: () => {
          recargarDocumentos();
          recargarConversaciones();
          notificar('Recargando documentos y conversaciones.');
        },
        abrirHilo,
      },
      hilos,
    );
  }, [
    conversaciones.estado,
    recargarDocumentos,
    recargarConversaciones,
    conversacion,
    preferencias.elegirTema,
    verDocumentos,
    verFuentes,
    abrirHilo,
    anunciar,
    notificar,
  ]);
```

```bash
npx prettier --write src/app/App.tsx src/features/comandos
npm run typecheck
npm run lint
```

`typecheck` pasa, pero **`lint` saca un aviso que en `main` no existe**. Esperado:

```text
src/app/App.tsx:191:7: warning react(refs): Cannot access refs during render ...
```

**Pégalo en la entrega.** Es oxlint, con su regla `react/refs`. Antes, las mismas lecturas de `shell.current` vivían en *closures* dentro de un array literal, y el linter veía que nadie las llamaba durante el render. Ahora esas funciones **se pasan a otra función** (`crearComandos`) que se ejecuta durante el render, y el linter no puede saber si `crearComandos` las llama o solo las guarda. Ante la duda, avisa. Aquí es un falso positivo, pero tienes que entenderlo para poder decidirlo tú (pregunta 5).

Silencia **solo esa línea**, con su justificación. Justo encima de la `{` que abre el objeto de acciones (la línea que señala el aviso), añade:

```tsx
      // Falso positivo de react/refs: crearComandos guarda estas funciones
      // sin llamarlas; el ref se lee al ejecutar el comando, en un evento.
      // oxlint-disable-next-line react/refs
```

La directiva tiene que ir en la línea **inmediatamente anterior**. Si pones el comentario explicativo debajo de ella, deja de aplicarse (me pasó al probarlo).

```bash
npm run lint                  # ahora sin avisos
npx vitest run                # esperado: Test Files 14 passed · Tests 120 passed
npx prettier --check src
npx knip --include files      # npm run limpieza: sin ficheros huérfanos
```

### Paso 5 — Verlo funcionar sin backend (5 min)

El servidor falso de las e2e basta para probarlo. Necesitas dos terminales, ambas en `frontend/`:

```bash
# terminal 1
node pruebas-e2e/servidor-falso.mjs 8099
```

```bash
# terminal 2
VITE_API_URL=http://localhost:8099 npm run dev
```

Abre `http://localhost:5173/app` con las DevTools en la pestaña *Network*, filtra por `graphql`, pulsa Ctrl+K (⌘K en Mac), escribe `refrescar` y pulsa Enter. Tienes que ver **dos POST a `/graphql`**: uno con `documentos { id ...` y otro con `conversaciones { id titul...`. Fíjate también en la lista de la columna lateral, que parpadea (es el 🟡 del día 15). Para los dos procesos con Ctrl+C.

### Paso 6 — Commit y push (3 min)

```bash
cd ~/ruta/AGENT4U
git status --short            # 3 ficheros: App.tsx, comandos.ts, comandos.test.ts
git add frontend/src
git commit -m "feat(paleta): comando para recargar las listas y crearComandos testeable"
git push -u origin ejercicio/dia-16
```

### Preguntas (responde con tus palabras)

1. ¿Por qué `AppShell` expone `abrirFuentes` y compañía por `ref` con `useImperativeHandle` y no como props `fuentesAbiertas`/`setFuentesAbiertas`? Da una ventaja y un coste concretos, y di si el `react/refs` de hoy es una consecuencia de esa decisión.
2. En escritorio, conversaciones es un `<aside>`; en móvil, un `<Drawer>`. ¿Por qué no un único componente que cambie de estilo con CSS? Nombra **tres** comportamientos que da `showModal()` y que un `<aside>` no tiene.
3. ¿Por qué `Drawer` y `PaletaComandos` escuchan `close` con `addEventListener` y no con la prop `onClose`? Describe el bug exacto que evita, paso a paso.
4. ¿Memoriza algo el `useMemo` de `comandos` después de tu cambio? Señala la línea de `useConversacion.ts` que lo impide y propón cómo arreglarlo **sin** tocar `App.tsx`.
5. Explica con tus palabras por qué `react/refs` avisa con `crearComandos(...)` y no con el array en línea. ¿Es un bug real? Propón un diseño alternativo en el que la lista no reciba funciones que leen el `ref`, y di qué pierdes con él.
6. El toast dice *"Recargando…"* y no *"Actualizado"*. ¿Por qué sería mentira decir "actualizado" en ese punto? ¿Qué tendría que devolver `reintentar` de `useRecurso` para poder avisar cuando las listas hayan llegado de verdad?
7. Explica el 🟠 del desalineamiento con un ejemplo propio. ¿Por qué hoy no se ve en la app? ¿Qué cambio inocente en `crearComandos` lo haría aparecer?

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-16` creada desde `main` y subida, con un commit que solo toca `App.tsx`, `comandos.ts` y `comandos.test.ts`.
- [ ] En la entrega, la salida en **rojo** del Paso 2 (`crearComandos is not a function`) y el aviso `react(refs)` del Paso 4.
- [ ] `npx vitest run`: 14 ficheros y 120 tests en verde.
- [ ] `npm run typecheck`, `npm run lint` (sin avisos), `npx prettier --check src` y `npx knip --include files`, limpios.
- [ ] La directiva `oxlint-disable-next-line react/refs` afecta a **una sola línea** y lleva su justificación.
- [ ] Paso 5 hecho: los dos POST a `/graphql` vistos en *Network* (basta con una frase o una captura).
- [ ] Las 7 preguntas respondidas con tus palabras, citando ficheros y líneas.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

**Bonus (opcional, 15-20 min): arregla el desalineamiento de la paleta.** En `src/features/comandos/PaletaComandos.tsx`, sustituye las dos líneas de `visibles` y `grupos` (l. 69-70) por:

```tsx
  const grupos = useMemo(
    () => agruparComandos(filtrarComandos(comandos, texto)),
    [comandos, texto],
  );
  // En el MISMO orden en que se pintan: las flechas, Enter y
  // aria-activedescendant indexan esta lista.
  const visibles = useMemo(() => grupos.flatMap((g) => g.comandos), [grupos]);
```

Y al final de `src/features/comandos/PaletaComandos.test.tsx`, el test de regresión:

```tsx
describe('PaletaComandos · grupos intercalados', () => {
  it('Enter ejecuta la opción marcada aunque su grupo llegue partido', async () => {
    const usuario = userEvent.setup();
    const [a, b, c] = [vi.fn(), vi.fn(), vi.fn()];
    render(
      <PaletaComandos
        abierta
        alCerrar={vi.fn()}
        comandos={[
          { id: 'a', titulo: 'A', grupo: 'Acciones', ejecutar: a },
          { id: 'b', titulo: 'B', grupo: 'Ir a', ejecutar: b },
          { id: 'c', titulo: 'C', grupo: 'Acciones', ejecutar: c },
        ]}
      />,
    );

    await usuario.click(screen.getByRole('combobox'));
    await usuario.keyboard('{ArrowDown}');

    // Se pinta A, C | B: la segunda opción en pantalla es C.
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe(
      'comando-c',
    );
    await usuario.keyboard('{Enter}');
    expect(c).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
  });
});
```

Hazlo en este orden: **primero el test, contra el componente sin arreglar**. Tiene que fallar (`1 failed | 16 passed` en `src/features/comandos`). Luego aplica el arreglo, y el total queda en 121 tests. Pega las dos salidas en la entrega. Con el arreglo, el comentario *"Justo detras de 'nueva'"* de `crearComandos` sobra: bórralo en el mismo commit.

Entrega antes de las **8:30 del sábado 21-nov**:

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-16.md
# ...rellena dia-16.md: salidas en rojo y en verde, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-16.md
git commit -m "entrega día 16" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code y te revisa la entrega y la rama al momento.

---

## 5. Para profundizar (opcional)

- MDN, el elemento `<dialog>`: `showModal()`, `::backdrop`, el evento `close` y la *top layer*. <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog>
- WAI-ARIA APG, el patrón *combobox* y `aria-activedescendant` (el contrato que el bonus repara): <https://www.w3.org/WAI/ARIA/apg/patterns/combobox/>

---

## 6. Aportación a `ARCHITECTURE.md`

Con esto cierras la sección *11. Frontend: cliente de API y flujos (días 13-16)*. Tu párrafo debería cubrir:

- `AppShell` como componente con huecos (`lateral`, `fuentes`, `documentos`, `children`): columnas en escritorio, `<dialog>` en móvil, el chat primero en el DOM y las órdenes por `ref` (`ControlesShell`).
- `shared/ui` como sistema propio y pequeño: una sola pieza rellena por pantalla, `IconButton` con etiqueta obligatoria, `<dialog>` nativo en `Drawer`, la pareja `Toasts` (visual) + `Anuncios` (lector) unida en `notificar`, y los colores por rol de `tokens.css` con `@theme inline`.
- La paleta: lógica pura en `comandos.ts` (ahora también `crearComandos`), subcadena sin acentos, combobox con `aria-activedescendant` y el historial como comandos.
- Los huecos conocidos: el desalineamiento por grupos partidos (o su arreglo, si haces el bonus), el panel de conversaciones que no se cierra en móvil, la e2e que se salta en móvil, el `useMemo` que no memoriza y los comentarios que describen otro diseño.

**El sábado 21-nov (día 17, sesión larga):** tests del backend y del gateway. Recorrerás los niveles de `backend/tests/` (unitarios, API con `TestClient`, integración y evaluación) y los dobles del gateway (`fake_client` en `conftest.py`, el mismo que rompiste en el día 15). Verás qué se sustituye en cada nivel y por qué. El ejercicio: escribir el test de tu endpoint `/stats` del día 04, y si no lo llegaste a crear, crearlo primero con su test.
