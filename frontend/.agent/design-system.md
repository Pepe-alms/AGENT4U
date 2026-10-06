# Sistema de diseño de AGENT4U

**Estado: IMPLEMENTADO** en la iteración 004 (T02), **rediseñado en la 007**,
**migrado a Tailwind v4 en la 023** y con **cuatro identidades distintas**
desde entonces: violeta sobre gris (023), crema y terracota (024), el lenguaje
de Apple (025) y, desde la 027, **la guía de estilo de OpenAI**. Las cuatro han
costado `tokens.css` y un barrido de clases, sin tocar un solo componente de
dominio: es exactamente lo que compra nombrar el color por rol.
Fuente de verdad en código: `src/shared/styles/tokens.css`.
Este documento explica el porqué; el CSS manda sobre lo que aquí se escriba.

## Cómo se escriben los estilos (desde la iteración 023)

**Tailwind v4 con utilidades, no `*.module.css`.** Los tokens siguen siendo CSS
variables y siguen mandando; lo que cambia es que ahora se consumen como
utilidades (`bg-superficie`, `text-tenue`, `rounded-m`).

El puente son dos capas en `tokens.css`, y el orden importa:

1. Los valores crudos viven en `:root` y se redefinen por tema. Son CSS plano,
   cambian en caliente y Tailwind no los conoce.
2. `@theme inline` los expone como utilidades. **El `inline` no es decorativo**:
   sin él Tailwind *copia* el valor dentro de cada utilidad y el cambio de tema
   deja de propagarse. Con él emite `var(--fondo)` y la redefinición llega sola.

`--spacing` cuelga de `--escala-densidad`, así que **toda** la escala de
espaciado de Tailwind (`p-2`, `gap-4`, `mt-6`…) se aprieta con una sola
variable cuando se activa el modo compacto. El texto y las alturas mínimas de
los controles van en `rem` fijos y no escalan: encoger el área pulsable es
justo lo que no debe hacer un modo compacto.

**No hay variante `dark:`, y es a propósito.** El tema se resuelve en los
tokens, que se nombran por rol: `bg-superficie` ya es el color correcto en los
dos temas. Escribir `bg-white dark:bg-black` duplicaría esa decisión en cada
clase y perdería el sistema.

**La única excepción que queda es `Respuesta.module.css`**, y tiene motivo:
estiliza el HTML que genera el markdown del modelo, donde no se pueden poner
clases de Tailwind porque los elementos los crea `marked`, no nosotros. Un
stylesheet acotado al contenedor es la herramienta correcta ahí.

## Regla permanente

Ningún valor visual suelto en los componentes: ni colores, ni tamaños, ni
espaciados, ni duraciones. Si falta un token, se añade primero a `tokens.css`
y se usa después.

## La identidad: lienzo, hairline y tipo

Lienzo blanco, tipo negro y **ningún color de marca**. La estructura la dan
líneas finas al 12% de negro, no sombras. Los radios son de 6px en las tarjetas
y píldora en todo lo interactivo. El único elemento relleno de la pantalla es
la acción principal, en negro.

Las reglas que de verdad producen ese aspecto:

1. **Hairlines, no sombras.** Las tarjetas no llevan sombra: la estructura son
   la línea fina y el aire. Las sombras sobreviven solo en lo que flota de
   verdad sobre el resto (modales y popovers), que la guía no cubre.
2. **6px en las tarjetas.** 12 o 16 desplazan el sistema hacia "SaaS amable".
3. **Píldora en todo lo interactivo**: botones, chips y campos. Es la firma
   geométrica y tiene que ser consistente.
4. **Un solo relleno por pantalla.** El negro sólido es el punto final de una
   frase monocroma; rellenar un segundo botón lo deja sin señal.
5. **El aire separa, no las reglas ni los fondos de color.**

## Color

Se nombra por **rol**, nunca por tono (`--acento`, no `--terracota`). Así un
tema es una redefinición de los mismos nombres y cambiar la paleta no obliga a
tocar un solo componente — que es exactamente lo que permitió hacer la 024 sin
tocar ni un componente de dominio.

Roles (utilidad de Tailwind → variable cruda): `bg-fondo` → `--fondo`,
`bg-superficie`, `bg-superficie-suave`, `bg-superficie-hover`, `border-borde`,
`border-borde-fuerte`, `text-texto` → `--txt`, `text-suave`, `text-tenue`,
`text-acento`, `bg-acento-hover`, `text-sobre-acento`, `bg-acento-suave`,
`error|exito|aviso` (cada uno con `-fondo` y `-borde`). El color del foco es
`--foco`, que no es utilidad porque lo aplica una sola regla global.

| | crema (por defecto) | tinta tostada |
|---|---|---|
| fondo | `#f4efe4` | `#15120e` |
| superficie | `#fbf8f1` | `#1e1a15` |
| texto | `#1c1814` | `#f2ebdd` |
| acento | `#a8481a` | `#e08a52` |

**El acento está medido, no elegido.** La terracota de libro (`#b4541f`) da
4.33:1 sobre el crema del fondo y no llega a AA; se oscureció hasta `#a8481a`,
que da 5.07:1. Las sombras tiñen de marrón y no de negro: una sombra gris sobre
crema lo ensucia y lo devuelve al gris del que se venía.

## Cómo se señala el estado sin color

Sin acento, el estado se dice con **peso, fondo y opacidad del hairline**:

| Qué | Cómo |
|---|---|
| Cita elegida | La píldora se rellena de negro |
| Fuente activa | El hairline se vuelve opaco (`border-texto`) |
| Hilo abierto | Fondo Ash y texto en peso medio |
| Barra de relevancia | Negro sobre Ash |
| Botón pulsado | El icono se enciende sobre Ash |

No queda **ningún gradiente** en la interfaz. En la iteración 022 había 23.

## La marca

El símbolo es una hoja con tres renglones, el del medio recortado y marcado con
un punto. Es literalmente lo que hace el producto —de toda la página, este
fragmento, y aquí está la cita— y por eso no es un monograma intercambiable:
significa algo.

Va **monocromo**, en `currentColor`, y el punto de la cita es la única pieza
azul de la cabecera. Una marca que se apoya en su forma y no en un relleno de
color envejece mucho mejor.

Vive en `shared/ui/Logo.tsx` como SVG, no como imagen: pesa menos de 1 kB, no
hace una petición, se mantiene nítido a cualquier tamaño, hereda el color del
tema y sirve igual de favicon (`public/sello.svg`, el mismo dibujo).

El nombre va en **texto de verdad** al lado, no dentro del SVG: así se
selecciona, se traduce y lo lee un lector de pantalla.

## Tipografía

| | Para qué |
|---|---|
| **Inter** (`--font-sans`) | Todo. Es el sustituto que la propia guía recomienda para OpenAI Sans, y va empaquetada |
| **JetBrains Mono** (`--font-mono`) | Solo cifras y metadatos técnicos. **Nunca prosa** |

Cuerpo a **17px con interlineado 1.65** y tracking −0.01em: la base algo mayor
y el aire entre líneas son lo que crea el ritmo de lectura editorial.

Titulares en peso **500**, con tracking negativo que se cierra según crece el
tamaño (−0.03em en el display). **El peso máximo es 600 y solo en un escalón**:
nada de 700 ni 800, que contra un tipo tan contenido se leen como un grito.

**No hay iconos dentro de botones ni enlaces.** El sistema es text-first; los
iconos se quedan en la barra de herramientas, que es área de utilidad.

Las cifras que cambian durante el streaming llevan `.tabular`
(`font-variant-numeric: tabular-nums`): sin eso bailan al actualizarse.

Las etiquetas de sección **ya no van en versalita muy espaciada**: ese es un tic
de panel de control. Una etiqueta pequeña en gris dice lo mismo sin gritar.
