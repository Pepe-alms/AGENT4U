# Backlog del frontend

## ROADMAP (fuente de verdad del orden)

| Tarea | Estado | Evidencia / qué falta |
|---|---|---|
| T01 Fundaciones | **HECHA** (iter. 003) | `src/{app,features,shared}`, `strict: true` y `paths` en `tsconfig.app.json`, alias en `vite.config.ts`, Prettier. `typecheck`, `lint`, `format:check` y `build` en verde. |
| T02 Design system en código | **HECHA** (iter. 004, rediseñado en la 007) | `shared/styles/{tokens,global}.css` + 9 componentes en `shared/ui`, usados en la vista real. Tema de 3 estados persistido. 20 parejas de color medidas, todas AA. Rediseño "rompedor" en la 007: gradiente de marca, aurora animada y 27 parejas de color medidas AA. |
| T03 Capa de datos | **HECHA** (iter. 005) | `shared/api/{cliente,errores,types,conversaciones,documentos,preguntar,salud}.ts`. Un solo `fetch` en todo `src/`. Parseo SSE puro probado 10/10, stream con cortes OK, contrato 4/4. |
| T04 App shell | **HECHA** (iter. 006, completada en la 007) | Grid de 3 zonas y `<dialog>` nativos como drawers bajo 1024px. Indicador con **las dos sondas reales**: `/health` y `/health/qdrant`, añadidos al backend en la iteración 007 con permiso de Pepe. |
| T05 Núcleo del chat | **HECHA** (iter. 008) | `features/chat/`: reducer puro (19/19 casos), `useConversacion` sobre el AsyncGenerator, composer autoexpandible y auto-scroll que no secuestra. Flujo completo verificado contra un stub SSE, incluidos Detener y error del modelo. |
| T06 Render de respuestas | **HECHA** (iter. 009) | `shared/lib/markdown.ts` con `marked` + `dompurify`: 11 vectores de XSS neutralizados. Listas, tablas, código, citas y enlaces seguros. Copiar por bloque y copiar respuesta. |
| T07 Citas | **HECHA** (iter. 010) | `[n]` convertidos en botones sobre nodos de texto del DOM saneado (14 vectores de XSS siguen neutralizados). Clic lleva a la tarjeta, resaltado cruzado en ambos sentidos, y en móvil abre el drawer. |
| T08 Estados vacíos y onboarding | **HECHA** (iter. 011) | Bienvenida con tres caras (con documentos / sin documentos / backend caído), sección de documentos en el lateral con sus cuatro estados, y `useRecurso` extraído. Ningún estado en blanco. |
| T09 Gestión de documentos | **HECHA** (iter. 013) | Drag & drop real contra `POST /indexar-fichero`, añadido al backend con permiso de Pepe (4 vectores de path traversal bloqueados, 21/21). Más URL, ruta del servidor, cola por trabajo y borrado. |
| T10 Historial de conversaciones | **HECHA** (iter. 014 y 015) | Lista agrupada por fecha, abrir hilo, continuar, borrar, nueva, el hilo sobrevive a la recarga, y **renombrar** con `PATCH /conversaciones/{id}` añadido al backend (12/12). |
| T11 Streaming | **HECHA** (verificada en iter. 015) | 11/11: escritura progresiva, `aria-busy`, cursor, y Detener que **corta de verdad** (258 → 258 tras abortar) dejando la UI coherente. |
| T12 Acciones sobre respuestas | **HECHA** (iter. 016) | Regenerar, 👍/👎 persistido tras recargar y copiar con referencias. 15/15 en puro, 8/8 acciones enfocables. El feedback va en `localStorage` detrás de una interfaz. |
| T13 Ajustes | **HECHA** (iter. 017 y 018) | Tema, densidad **y parámetros de consulta**: número de fragmentos y modelo, añadidos al backend con permiso de Pepe (20/20) y servidos por `GET /ajustes`. Todo persiste tras recargar. |
| T14 Atajos y command palette | **HECHA** (iter. 019) | Paleta con Cmd/Ctrl+K: nueva conversación, ir a documentos y fuentes, ajustes, tema y **búsqueda en el historial**. Filtrado 18/18, recorrido completo sin ratón. |
| T15 Pase de accesibilidad | **HECHA** (iter. 020) | Auditoría a 0 fallos. Enlaces de salto, `<main>` antes en el DOM (el composer pasa de la parada 17 a la 8), región de anuncios permanente y `prefers-reduced-motion` verificado. **Falta probarlo con un lector real.** |
| T16 Rendimiento y pulido | **HECHA** (iter. 021) | Medido antes de optimizar: escribir cuesta x1.0 con el hilo cargado y el reparseo 7 ms, así que **no se memoizó nada**. Sí se difirió el markdown: bundle inicial de 319 a **245 kB**. |
| T17 Tests | **HECHA** (iter. 022) | `vitest` + jsdom + Testing Library y Playwright sobre el build. **60 pruebas de unidad en 8 ficheros y 3 de punta a punta**, todas en verde, con `npm run verificar` como única puerta. El servidor falso vive en el repositorio. Encontró **dos fallos reales**: el clic en una cita se perdía al pasar el ratón por encima, y el id del hilo tardaba un fotograma en guardarse. |

**Progreso: 17/17. Roadmap completo.** (T02 y T04 revisitadas en la iteración 007.)

## Abierto por el cambio de identidad (iteración 025)

| # | Mejora | I | E | Justificación |
|---|---|---|---|---|
| 59 | Sin imagen en ninguna parte | Medio | Alto | Buena parte del efecto de la web de Apple viene de fotografía de producto a pantalla completa, y aquí no hay ninguna. El carácter sale de la escala, el vacío y la elevación. Si se quiere acercar más, lo que falta es imagen, no más ajustes de color. |
| 60 | Un token borrado no rompe el build | Medio | Bajo | Al quitar los gradientes quedaron cinco `var()` apuntando a variables inexistentes, y ni el typecheck ni oxlint lo vieron: una `var()` sin resolver simplemente no pinta. Un script que cruce los `var(--x)` de `src/` contra los definidos en `tokens.css` lo cazaría, y cabe en `verificar`. |
| ~~58~~ | ~~Sin versión del sello para fondos claros~~ | — | — | **Cerrado en la 025**: el logo es monocromo y hereda el color del tema. |
| ~~57~~ | ~~El grano de papel no se adapta a HiDPI~~ | — | — | **Cerrado en la 025**: ya no hay grano. |

## Abierto por el cambio de identidad (iteración 024)

| # | Mejora | I | E | Justificación |
|---|---|---|---|---|
| 57 | El grano de papel no se adapta a pantallas HiDPI | Bajo | Bajo | El ruido SVG se repite cada 160 px lógicos; en una pantalla de 3x se ve un pelín más fino de lo ideal. No molesta, pero se podría ajustar con `image-rendering` o una `baseFrequency` por `resolution`. |
| 58 | Sin versión del sello para fondos claros planos | Bajo | Mínimo | `public/sello.svg` lleva los colores del tema crema fijos, porque un favicon no puede leer variables CSS. En el tema oscuro el favicon sigue siendo el de crema. Se resuelve con un segundo SVG y `media` en el `<link>`. |

## Abierto por el rediseño (iteración 023)

| # | Hueco | I | E | Justificación |
|---|---|---|---|---|
| 52 | Sin estadísticas de la colección | Bajo | Medio | El estado inicial pide "N documentos · N fragmentos indexados". No hay endpoint que lo dé y **no se inventan datos**. Haría falta un `GET /documentos/resumen` o un conteo en `/health/qdrant`. |
| 53 | Los pasos del agente no se persisten | Bajo | Medio | Al recargar un hilo vuelven vacíos: el backend no los guarda. Es correcto —son el registro de una ejecución, no parte de la respuesta— pero conviene saberlo antes de que alguien lo reporte como fallo. |
| 54 | Motion cuesta ~34 kB gz | Bajo | Medio | El bundle pasa de 76 a 110,7 kB gz. Se recortó lo posible (124,4 → 110,7) con `motion/react-m`; más no se puede, el motor comparte módulo con `AnimatePresence`. Quitarlo del todo es viable con CSS moderno (`interpolate-size`, `@starting-style`), a cambio de la animación de salida en navegadores que aún no lo soportan. |
| 55 | `origen` llega vacío en las fuentes | Bajo | Bajo | `cross_encode` solo guarda `url`, que es `None` para ficheros locales, así que el `title` de la tarjeta cae al nombre. Se ve bien, pero el dato está ahí sin aprovechar. |
| 56 | Toasts sin cola de prioridad | Bajo | Bajo | Se limitan a 3 y se descartan los más viejos. Si llegan varios errores a la vez, alguno se pierde sin que nadie lo lea. |

## Lo que falta de la suite de tests (iteración 022)

| # | Hueco | I | E | Justificación |
|---|---|---|---|---|
| 47 | Sin contrato compartido con el backend | Alto | Alto | El servidor falso reproduce el contrato **a mano**. Si el backend cambia una forma, la suite sigue verde y la aplicación se rompe. Lo arreglaría generar los tipos del OpenAPI de FastAPI. |
| 48 | Sin cobertura medida | Bajo | Bajo | No hay umbral a propósito, pero tampoco se sabe qué queda sin tocar. `vitest --coverage` lo diría sin imponer una cifra. |
| 49 | Un solo navegador | Bajo | Bajo | Solo `chrome`. Los `<dialog>` y `AbortSignal.any` son recientes y Safari es donde más probable es que fallen. |
| 50 | Sin regresión visual | Medio | Medio | El diseño se valida a ojo cada iteración. Una captura de referencia por vista pillaría lo que se rompe sin que nadie lo note. |
| 51 | La suite no corre en CI | Medio | Bajo | `npm run verificar` existe pero depende de que alguien lo ejecute. Decisión de Pepe, porque implica tocar GitHub Actions. |

## Fuera del roadmap, pendiente

| # | Mejora | I | E | Justificación |
|---|---|---|---|---|
| 20 | Endurecer `.oxlintrc.json` | Medio | Bajo | Hoy 2 reglas. La categoría `correctness` habría pillado el `useState([])` sin tipo. Ahora hay suite de tests que respalda el cambio: se puede endurecer y comprobar que nada se rompe. |
| 22 | Limpiar `frontend/.env.example` | Bajo | Mínimo | Sus comentarios son copia del backend: hablan de `Settings`, de tests y de la clave del LLM, y listan variables `APP_*` que Vite nunca leerá. |
| 25 | Rama `feature` bloquea el namespace `feature/*` | Bajo | Mínimo | Git no admite a la vez `feature` y `feature/algo`. Decisión de Pepe borrarla o renombrarla. |
| 26 | Borrar `feat/frontend-iter-002-estructura` | — | Mínimo | Tiene tres commits con `Co-Authored-By: Claude`, que Pepe no quiere. Su contenido está incorporado en el árbol actual. `git branch -D feat/frontend-iter-002-estructura`. |
| 32 | Reiniciar el backend | Alto | Mínimo | Los endpoints `/health` existen en el código pero el proceso de Pepe corre **sin `--reload`**, así que no los sirve. Hay que reiniciarlo para verlos. |
| 29 | Módulos de API sin consumidor | — | — | **Cerrado**: todos tienen consumidor desde T09/T13. |
| ~~33~~ | ~~Render y parseo por trozo~~ | — | — | **Cerrado en la iteración 021**: medido, 0,10 ms por pulsación y 7 ms por respuesta completa. No era un problema. |
| ~~35~~ | ~~Bundle inflado por marked + dompurify~~ | — | — | **Cerrado en la iteración 021**: carga diferida, 319 → 245 kB iniciales. |
| ~~34~~ | ~~El hilo no se carga de `/conversaciones`~~ | — | — | **Cerrado en T10** y cubierto por la prueba de punta a punta del recargado. |
| 36 | El panel de fuentes solo muestra las del último mensaje | Medio | Medio | Con varios turnos, las fuentes de respuestas anteriores no son consultables desde el panel. **Subió de prioridad en la 023**: las insignias que había bajo cada mensaje se quitaron al rediseñar, así que ahora no hay ninguna otra forma de llegar a ellas. |
| 45 | `search_chunks` sigue con `limit=20` fijo | Bajo | Bajo | Los fragmentos que se recuperan antes de reordenar están codificados a fuego. Es trabajo interno del reordenado y subirlo no mejora la respuesta, pero conviene saberlo. |
| 39 | Reiniciar el backend (otra vez) | Alto | Mínimo | `/indexar-fichero` y `/health` existen en el código, pero el proceso de Pepe corre **sin `--reload`**. Además hace falta `uv sync` por la dependencia nueva. |
| 46 | Sin verificar con lector de pantalla | Medio | — | El árbol de accesibilidad está comprobado, pero no cómo suena. **Pepe debería pasarle VoiceOver** (Cmd+F5) al flujo de preguntar. |
| ~~41~~ | ~~`Card` y `Textarea` sin consumidor~~ | — | — | **Cerrado en la 023**: borrados. |
| 42 | **No hay endpoint de feedback** | Medio | — | Las valoraciones viven en `localStorage`, así que no salen del navegador. `RepositorioValoraciones` está listo para enchufarle un backend. |
| 43 | Regenerar no sustituye la respuesta | Medio | — | El backend no permite borrar ni reemplazar un mensaje, así que la respuesta nueva se añade al final y conviven las dos. |
| 38 | La ingesta no informa de progreso real | Bajo | Medio | El endpoint responde de una vez; para una barra de verdad haría falta SSE también en `/indexar`. Hoy es un spinner. |
| 30 | Escape y backdrop del Drawer sin verificar | Medio | Mínimo | Chrome headless no emite el evento `close`, así que no se pudo comprobar de forma automatizada. **Pepe debería probarlo a mano.** El resto del ciclo (abrir, cerrar con botón, reabrir) sí está verificado. |
| ~~31~~ | ~~El panel de fuentes está vacío~~ | — | — | **Cerrado en T07.** |
