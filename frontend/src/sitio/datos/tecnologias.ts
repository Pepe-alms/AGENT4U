/**
 * El inventario, por capas.
 *
 * `paraQue` NO es la descripcion del README de la herramienta: es el trabajo
 * concreto que hace en ESTE proyecto. Si una entrada se pudiera copiar tal
 * cual a otro proyecto, esta mal escrita.
 */
export type Capa =
  'Frontend' | 'Backend' | 'IA / LLM' | 'Vector DB' | 'Infra / CI-CD' | 'Observabilidad';

export const CAPAS: Capa[] = [
  'Frontend',
  'Backend',
  'IA / LLM',
  'Vector DB',
  'Infra / CI-CD',
  'Observabilidad',
];

/**
 * El slug que viaja en la query (`?capa=backend`).
 *
 * Se escribe a mano y no se deriva del nombre: derivarlo significaria que
 * retocar "IA / LLM" rompe todos los enlaces que alguien haya compartido.
 */
export const SLUG_CAPA: Record<Capa, string> = {
  Frontend: 'frontend',
  Backend: 'backend',
  'IA / LLM': 'ia',
  'Vector DB': 'vector-db',
  'Infra / CI-CD': 'infra',
  Observabilidad: 'observabilidad',
};

export function capaDeSlug(slug: string | null): Capa | null {
  if (!slug) return null;
  return CAPAS.find((capa) => SLUG_CAPA[capa] === slug) ?? null;
}

export type Tecnologia = {
  nombre: string;
  version: string;
  capa: Capa;
  paraQue: string;
};

export const TECNOLOGIAS: Tecnologia[] = [
  // --- Frontend ---
  {
    nombre: 'React',
    version: '19.2',
    capa: 'Frontend',
    paraQue:
      'La conversación entera, el panel de fuentes y la línea de tiempo del agente. El estado del chat vive en un reducer puro, fuera de los componentes.',
  },
  {
    nombre: 'TypeScript',
    version: '6.0',
    capa: 'Frontend',
    paraQue:
      'En modo estricto. Los eventos del stream son una unión discriminada, así que olvidar un caso del `switch` no compila.',
  },
  {
    nombre: 'Vite',
    version: '8.2',
    capa: 'Frontend',
    paraQue:
      'Build y servidor de desarrollo. El puerto está fijado con `strictPort` porque el backend solo admite CORS desde uno concreto.',
  },
  {
    nombre: 'Tailwind CSS',
    version: '4.3',
    capa: 'Frontend',
    paraQue:
      'Los tokens se exponen con `@theme inline`, que emite `var(--x)` en vez de copiar el valor: por eso el cambio de tema se propaga sin recompilar.',
  },
  {
    nombre: 'Motion',
    version: '14.0',
    capa: 'Frontend',
    paraQue:
      'El revelado al hacer scroll, el plegado de los paneles y la línea de tiempo del agente. Se importa de `motion/react-m` para no arrastrar la fábrica completa.',
  },
  {
    nombre: 'marked + DOMPurify',
    version: '18.0 · 3.4',
    capa: 'Frontend',
    paraQue:
      'El markdown del modelo se parsea y después se sanea, en ese orden. Es el único origen permitido de HTML inyectado.',
  },

  // --- Backend ---
  {
    nombre: 'FastAPI',
    version: '0.115',
    capa: 'Backend',
    paraQue:
      'Los endpoints y el stream SSE. La respuesta sale de un generador que se consume después de que el endpoint devuelva, así que el trabajo con la sesión se hace antes.',
  },
  {
    nombre: 'Pydantic',
    version: '2.9',
    capa: 'Backend',
    paraQue:
      'Valida la entrada y define el contrato. Los campos nuevos llevan valor por defecto para que los mensajes ya guardados sigan deserializando.',
  },
  {
    nombre: 'SQLAlchemy',
    version: '2.0',
    capa: 'Backend',
    paraQue:
      'Conversaciones, mensajes y documentos. Renombrar usa un `update()` explícito para esquivar el `onupdate` de la columna de fecha.',
  },
  {
    nombre: 'SQLite',
    version: '3',
    capa: 'Backend',
    paraQue:
      'La base de datos. Es una aplicación local sobre documentos propios: un servidor de base de datos más sería una pieza que mantener sin ganar nada.',
  },
  {
    nombre: 'uv',
    version: '0.5',
    capa: 'Backend',
    paraQue:
      'Resolución e instalación de dependencias de Python, con el lock en el repositorio.',
  },

  // --- IA / LLM ---
  {
    nombre: 'LangGraph',
    version: '0.2',
    capa: 'IA / LLM',
    paraQue:
      'El grafo del agente: reformular, descomponer, buscar, fusionar, evaluar y reescribir. Hay un ciclo real, y una cadena lineal no lo expresa.',
  },
  {
    nombre: 'LiteLLM',
    version: '1.5',
    capa: 'IA / LLM',
    paraQue:
      'La capa que habla con el modelo. Cambiar de proveedor es cambiar una cadena, no reescribir la integración.',
  },
  {
    nombre: 'Gemini Flash',
    version: 'latest',
    capa: 'IA / LLM',
    paraQue:
      'Redacta la respuesta final y reformula las consultas. Va contra lista blanca, porque un modelo inválido hay que rechazarlo antes de abrir el stream.',
  },
  {
    nombre: 'Docling',
    version: '2.14',
    capa: 'IA / LLM',
    paraQue:
      'Convierte PDF y páginas web en estructura, no en texto plano. De ahí salen los títulos de sección que después permiten decir dónde estaba la cita.',
  },

  // --- Vector DB ---
  {
    nombre: 'Qdrant',
    version: '1.12',
    capa: 'Vector DB',
    paraQue:
      'Guarda vectores densos y dispersos del mismo fragmento y resuelve la búsqueda híbrida con fusión RRF en una sola consulta.',
  },
  {
    nombre: 'FastEmbed',
    version: '0.4',
    capa: 'Vector DB',
    paraQue:
      'Genera los dos vectores en local, sin llamar a una API de embeddings. Lo que se indexa no sale de la máquina.',
  },
  {
    nombre: 'Cross-encoder',
    version: 'bge-reranker',
    capa: 'Vector DB',
    paraQue:
      'Reordena los candidatos leyendo pregunta y fragmento juntos. Su puntuación no está acotada y puede ser negativa: solo sirve para comparar dentro de una misma respuesta.',
  },

  // --- Infra / CI-CD ---
  {
    nombre: 'Docker Compose',
    version: '2.29',
    capa: 'Infra / CI-CD',
    paraQue: 'Levanta Qdrant con su volumen persistente junto al backend.',
  },
  {
    nombre: 'Vitest',
    version: '4.1',
    capa: 'Infra / CI-CD',
    paraQue:
      'Las pruebas de lógica y de árbol renderizado: el reducer del chat, el parseo SSE y el filtrado de la paleta de comandos.',
  },
  {
    nombre: 'Playwright',
    version: '1.63',
    capa: 'Infra / CI-CD',
    paraQue:
      'Los caminos que, si se rompen, rompen el producto. Corre contra el build y un backend de mentira que vive en el repositorio.',
  },
  {
    nombre: 'oxlint + Prettier',
    version: '1.79 · 3.9',
    capa: 'Infra / CI-CD',
    paraQue:
      'Una sola puerta: `npm run verificar` encadena typecheck, lint, formato, unidad y punta a punta.',
  },

  // --- Observabilidad ---
  {
    nombre: 'Sondas de salud',
    version: '—',
    capa: 'Observabilidad',
    paraQue:
      'Dos endpoints y no uno: "backend caído" y "backend vivo con Qdrant caído" son averías distintas y se arreglan de forma distinta.',
  },
  {
    nombre: 'Eventos del grafo',
    version: '—',
    capa: 'Observabilidad',
    paraQue:
      'Cada nodo emite un evento con su duración al terminar. Es lo que convierte los 3,5 s de trabajo del agente en algo que se ve.',
  },
  {
    nombre: 'Scores en la respuesta',
    version: '—',
    capa: 'Observabilidad',
    paraQue:
      'Cada fuente viaja con su puntuación y la subconsulta que la encontró, para poder auditar por qué el agente eligió lo que eligió.',
  },
];

/**
 * Las piezas del diagrama de arquitectura que usan cada capa.
 *
 * Se deriva de NODOS en vez de escribirse otra vez: una segunda lista a mano
 * es una lista que acaba sin actualizar.
 */
export function piezasDeCapa(
  capa: Capa,
  nodos: Array<{ id: string; nombre: string; capa?: Capa }>,
) {
  return nodos.filter((n) => n.capa === capa);
}
