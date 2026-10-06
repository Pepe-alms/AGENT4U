/**
 * Los componentes del sistema y lo que se decidio al elegirlos.
 *
 * `x` e `y` son coordenadas dentro del lienzo 900x520 del diagrama. Mover un
 * nodo aqui lo mueve en el SVG y en el panel; no hay una segunda lista de
 * posiciones que mantener sincronizada.
 */
import type { Capa } from '@/sitio/datos/tecnologias';

export type NodoArquitectura = {
  id: string;
  nombre: string;
  /** La capa de /tecnologias a la que pertenece. Enlaza las dos paginas. */
  capa?: Capa;
  /** La frase de una linea que va dentro del nodo del diagrama. */
  rol: string;
  tecnologia: string;
  responsabilidad: string;
  /** Lo que se decidio y por que. Es lo que de verdad interesa leer. */
  decisiones: string[];
  x: number;
  y: number;
  ancho?: number;
};

export const NODOS: NodoArquitectura[] = [
  {
    id: 'front',
    capa: 'Frontend',
    nombre: 'Frontend',
    rol: 'React + Vite',
    tecnologia: 'React 19 · TypeScript 6 · Vite 8 · Tailwind 4',
    responsabilidad:
      'Pinta la conversación, consume el stream de respuesta token a token y mantiene la trazabilidad de cada cita hasta su fragmento.',
    decisiones: [
      'Una sola puerta a la red: ninguna vista llama a `fetch` directamente. Los fallos salen siempre como un `ErrorApi` con un `tipo`, para que la interfaz decida mirando el tipo y no parseando mensajes.',
      'La lógica del chat vive en un reducer puro, fuera de React: el riesgo real está en el orden de los eventos del stream, y así se prueba sin montar un componente.',
      'Sin librería de datos. Con una vista, TanStack Query aportaba más superficie que valor.',
    ],
    x: 40,
    y: 220,
  },
  {
    id: 'api',
    capa: 'Backend',
    nombre: 'API',
    rol: 'FastAPI',
    tecnologia: 'FastAPI · Pydantic · Uvicorn',
    responsabilidad:
      'Expone los endpoints, valida la entrada con Pydantic y emite la respuesta como Server-Sent Events.',
    decisiones: [
      'SSE y no WebSocket: el flujo es de ida, del servidor al cliente, y SSE reconecta solo y atraviesa proxies sin configuración.',
      'El trabajo contra la base de datos se hace antes de devolver el generador: la sesión la inyecta FastAPI por petición y se cierra al devolver el endpoint, mientras que el generador lo consume después.',
      'Un fallo del modelo viaja dentro de un 200, como evento: a mitad del stream ya no se puede devolver un código de error.',
    ],
    x: 240,
    y: 220,
  },
  {
    id: 'agente',
    capa: 'IA / LLM',
    nombre: 'Agente',
    rol: 'Orquestador',
    tecnologia: 'LangGraph',
    responsabilidad:
      'Reformula la pregunta, la descompone en subconsultas, busca, fusiona, evalúa si el contexto da para responder y reescribe si no.',
    decisiones: [
      'Grafo explícito y no una cadena: hay un ciclo real (evaluar → reescribir → buscar) y una cadena lineal no lo expresa.',
      'El grafo se ejecuta en modo `stream`, no `invoke`: así cada nodo emite un evento al terminar. Con `invoke` eran 3,5 segundos de pantalla quieta antes del primer token.',
      'El reparto por subconsultas tiene cuota por rama, para que una subconsulta prolífica no se coma el presupuesto de fragmentos.',
    ],
    x: 450,
    y: 120,
    ancho: 150,
  },
  {
    id: 'qdrant',
    capa: 'Vector DB',
    nombre: 'Qdrant',
    rol: 'Vector store',
    tecnologia: 'Qdrant · FastEmbed',
    responsabilidad:
      'Guarda los vectores densos y dispersos de cada fragmento y resuelve la búsqueda híbrida con fusión RRF.',
    decisiones: [
      'Búsqueda híbrida, no solo densa: el vector denso falla con nombres propios y códigos, y el disperso los acierta.',
      'La fusión es RRF, que combina los dos rankings sin tener que calibrar pesos entre dos escalas que no son comparables.',
      'El payload guarda `texto`, `nombre`, `paginas` y `headings`, para que la cita pueda señalar el sitio exacto.',
    ],
    x: 690,
    y: 120,
  },
  {
    id: 'llm',
    capa: 'IA / LLM',
    nombre: 'LLM',
    rol: 'Redacción',
    tecnologia: 'LiteLLM · Gemini Flash',
    responsabilidad:
      'Redacta la respuesta con los fragmentos delante y marca de dónde sale cada afirmación.',
    decisiones: [
      'LiteLLM como capa intermedia: cambiar de proveedor es cambiar una cadena, no reescribir la integración.',
      'El modelo va contra lista blanca. Un modelo inválido tiene que rechazarse antes de abrir el stream, porque después ya no hay código de error que devolver.',
      'Se le pasa el texto del fragmento, no un resumen: resumir antes de redactar es perder la trazabilidad.',
    ],
    x: 690,
    y: 320,
  },
  {
    id: 'documentos',
    capa: 'Backend',
    nombre: 'Documentos',
    rol: 'Almacenamiento',
    tecnologia: 'SQLite · sistema de ficheros',
    responsabilidad:
      'Guarda el registro de documentos, las conversaciones y los mensajes con sus fuentes.',
    decisiones: [
      'SQLite y no Postgres: es una aplicación local sobre documentos propios y un servidor de base de datos más es una pieza que mantener sin ganar nada.',
      'El nombre de un fichero subido nunca se usa tal cual: se reduce con `basename` y se comprueba que el destino no sale de la carpeta de subidas.',
      'Renombrar una conversación no toca `actualizada_en`: la lista se ordena por esa fecha y renombrar no es conversar.',
    ],
    x: 450,
    y: 320,
    ancho: 150,
  },
  {
    id: 'ingesta',
    capa: 'IA / LLM',
    nombre: 'Ingesta',
    rol: 'Indexación',
    tecnologia: 'Docling · FastEmbed',
    responsabilidad:
      'Convierte PDF, Markdown y páginas web en fragmentos con metadatos, los vectoriza y los sube a Qdrant.',
    decisiones: [
      'El troceado respeta la estructura del documento y no un número fijo de caracteres: partir una tabla por la mitad produce fragmentos que no significan nada.',
      'Cada fragmento conserva los títulos de sección que lo contienen, que es lo que después permite decir dónde estaba.',
      'La ingesta va sin tiempo límite en el cliente: convertir, trocear y vectorizar tarda mucho más que los 15 s por defecto.',
    ],
    x: 240,
    y: 420,
  },
];

/** Las flechas del diagrama. `etiqueta` se pinta sobre la linea. */
export const ENLACES: Array<{ de: string; a: string; etiqueta?: string }> = [
  { de: 'front', a: 'api', etiqueta: 'SSE' },
  { de: 'api', a: 'agente' },
  { de: 'agente', a: 'qdrant', etiqueta: 'híbrida' },
  { de: 'agente', a: 'llm' },
  { de: 'api', a: 'documentos' },
  { de: 'ingesta', a: 'qdrant' },
  { de: 'ingesta', a: 'documentos' },
];

/** El flujo de ingesta, como linea de tiempo horizontal. */
export const FLUJO_INGESTA = [
  {
    titulo: 'Carga',
    detalle: 'PDF, Markdown o una URL. Se guarda el original y se registra el documento.',
  },
  {
    titulo: 'Troceado',
    detalle:
      'Se parte por estructura, no por longitud, conservando los títulos de sección.',
  },
  {
    titulo: 'Embeddings',
    detalle:
      'Cada fragmento se vectoriza dos veces: denso para el significado, disperso para los términos exactos.',
  },
  {
    titulo: 'Indexado',
    detalle:
      'Los vectores y el payload suben a Qdrant. A partir de aquí el fragmento es consultable.',
  },
];
