# Roadmap de AGENT4U (solo lectura)

Reconstruido en la iteración 004 a partir del roadmap que Pepe pegó en el prompt
de la iteración 003. No se modifica: el estado de cada tarea vive en `backlog.md`.

## Visión del producto

Un espacio de trabajo "chat-first" para conversar con una base de conocimiento, a
la altura de Perplexity o NotebookLM:

- Layout de tres zonas: barra lateral (conversaciones y documentos), chat central
  y panel de fuentes colapsable.
- Respuestas legibles, con citas [n] clicables que llevan al fragmento exacto.
- Ingesta de documentos (PDF, DOCX, URL) con feedback claro de progreso.
- Historial de conversaciones persistente.
- Estado del sistema visible (backend y Qdrant).
- Sensación de producto premium: design system coherente, modo claro y oscuro,
  responsive, accesible (AA), atajos de teclado y microinteracciones sobrias.

## Tareas

| Id | Nombre | Criterio de HECHO |
|---|---|---|
| T01 | Fundaciones. Estructura por features (`app/`, `features/<x>/`, `shared/ui`, `shared/lib`, `shared/api`), TypeScript estricto, alias de imports, lint y format. | La app arranca, lint y typecheck en verde, ningún fichero fuera de la estructura. |
| T02 | Design system en código. Tokens (color semántico, tipografía, espaciado, radios, sombras, motion) como variables CSS o tema, modo claro y oscuro con toggle, y componentes base: Button, IconButton, Input, Textarea, Card, Badge, Spinner, Skeleton y Tooltip. Documentado en `design-system.md`. | Los componentes base se usan en la app y no hay valores visuales sueltos en las vistas tocadas. |
| T03 | Capa de datos. Cliente API centralizado y tipado, errores normalizados, timeouts y cancelación. | Ninguna llamada `fetch` fuera de `shared/api`. |
| T04 | App shell. Layout de tres zonas responsive (en móvil, sidebar y fuentes como drawers) y header con indicador de salud de backend y Qdrant. | El layout funciona a 375px, 768px y 1440px, y el indicador refleja la caída del backend. |
| T05 | Núcleo del chat. Lista de mensajes; composer autoexpandible (Enter envía, Shift+Enter salto); estados de enviando, error con reintento y deshabilitado; auto-scroll que no secuestra al usuario. | Flujo de pregunta y respuesta completo contra /preguntar, incluidos errores. |
| T06 | Render de respuestas. Markdown sanitizado, bloques de código con copiar, botón de copiar respuesta y tipografía de lectura. | Una respuesta con listas, código y tablas se ve impecable en ambos temas. |
| T07 | Citas. Marcadores [n] inline clicables que abren o resaltan su tarjeta en el panel de fuentes, con resaltado cruzado al pasar el ratón. | Cada cita de una respuesta real navega a su fuente correcta. |
| T08 | Estados vacíos y onboarding. Pantalla inicial con preguntas de ejemplo, estado "no hay documentos indexados" y estado de backend caído. | Ningún estado de la app muestra una pantalla en blanco. |
| T09 | Gestión de documentos. Ingesta con drag & drop (PDF/DOCX) y URL contra /indexar; progreso, éxito y error por fichero; lista de documentos indexados. | Indexo un PDF desde la UI y puedo preguntar por él justo después. |
| T10 | Historial de conversaciones. Persistencia detrás de una interfaz de repositorio; nueva conversación, renombrar, borrar y agrupación por fecha. | Recargo la página y no pierdo nada. |
| T11 | Streaming. UI de escritura progresiva con botón "detener" (AbortController). | El botón detener cancela la petición y la UI queda en un estado coherente. |
| T12 | Acciones sobre respuestas. Regenerar, feedback 👍/👎 persistido en local y copiar con referencias. | Las tres acciones funcionan y son accesibles por teclado. |
| T13 | Ajustes. Panel de preferencias (tema, densidad) y parámetros de consulta si el backend los acepta. | Las preferencias persisten entre sesiones. |
| T14 | Atajos y command palette (Cmd/Ctrl+K): nueva conversación, buscar en historial, cambiar tema e ir a documentos. | Todo lo principal se puede hacer sin ratón. |
| T15 | Pase de accesibilidad. Semántica, orden de foco, focus visible, aria-live para respuestas nuevas, contraste AA y prefers-reduced-motion. | El flujo principal se completa solo con teclado y lector de pantalla. |
| T16 | Rendimiento y pulido. Code splitting por vistas, memoización con evidencia, microinteracciones sobrias y revisión de bundle. | Sin re-renders evidentes al escribir en el composer y bundle inicial revisado. |
| T17 | Tests. Unitarios de componentes clave y e2e (Playwright) del flujo indexar → preguntar → ver cita. | Suite en verde y ejecutable con un solo comando. |
