import type { LucideIcon } from 'lucide-react';
import { Binary, FileSearch, ListFilter, MessageSquareQuote, Search } from 'lucide-react';

/**
 * Contenido de la portada.
 *
 * Todo lo de aqui es de ejemplo y esta pensado para sustituirse. Lo que hay
 * que cambiar para enchufarlo a FastAPI esta al final del fichero.
 */

export const TITULAR = 'Pregunta a tus documentos.';
export const SUBTITULO =
  'Respuestas con citas, trazadas hasta el fragmento exacto del que salen. Nada de inventos: si no está en tus documentos, el agente lo dice.';

/**
 * Las preguntas que escribe y borra el placeholder. Deben ser preguntas REALES
 * sobre los documentos indexados: una pregunta generica ahi es una promesa que
 * la aplicacion no cumple.
 */
export const PREGUNTAS_PLACEHOLDER = [
  '¿Qué dice el teorema CAP sobre las particiones de red?',
  'Resume el capítulo de índices invertidos',
  '¿Qué patrones de resiliencia hay en microservicios?',
  'Compara B-trees con LSM-trees',
];

/** Chips de debajo del input. Al pulsarlos rellenan el campo. */
export const SUGERENCIAS = [
  '¿Qué es la consistencia eventual?',
  'Explica el reparto por compartimentos',
  '¿Cuándo conviene un LSM-tree?',
];

/** Milisegundos por caracter del efecto maquina de escribir. */
export const MS_POR_CARACTER = 40;
export const MS_BORRANDO = 22;
export const MS_PAUSA_FINAL = 1600;

/* --- El pipeline: los cinco pasos del sistema --- */

export type Paso = {
  id: string;
  icono: LucideIcon;
  titulo: string;
  /** Dos lineas, no mas: esto se lee de un vistazo. */
  explicacion: string;
  ejemplo: 'consulta' | 'vector' | 'fragmentos' | 'reordenado' | 'respuesta';
};

export const PASOS: Paso[] = [
  {
    id: 'pregunta',
    icono: Search,
    titulo: 'Pregunta',
    explicacion:
      'Tu pregunta se reformula con el historial de la conversación y se descompone en subconsultas cuando pide varias cosas a la vez.',
    ejemplo: 'consulta',
  },
  {
    id: 'embedding',
    icono: Binary,
    titulo: 'Embedding',
    explicacion:
      'Cada subconsulta se convierte en un vector de números que captura su significado, no sus palabras.',
    ejemplo: 'vector',
  },
  {
    id: 'busqueda',
    icono: FileSearch,
    titulo: 'Búsqueda vectorial',
    explicacion:
      'Qdrant compara ese vector con los de todos tus fragmentos y devuelve los más cercanos, aunque no compartan ni una palabra.',
    ejemplo: 'fragmentos',
  },
  {
    id: 'reordenado',
    icono: ListFilter,
    titulo: 'El agente decide',
    explicacion:
      'Un reordenador puntúa los candidatos y el agente evalúa si el contexto da para responder. Si no, reescribe la consulta y vuelve a buscar.',
    ejemplo: 'reordenado',
  },
  {
    id: 'respuesta',
    icono: MessageSquareQuote,
    titulo: 'Respuesta con fuentes',
    explicacion:
      'El modelo redacta con los fragmentos delante y marca de dónde sale cada afirmación, para que puedas comprobarla.',
    ejemplo: 'respuesta',
  },
];

/** Fragmentos de ejemplo del paso de busqueda, con su puntuacion. */
export const FRAGMENTOS_EJEMPLO = [
  {
    documento: 'manual-cap.pdf',
    texto: 'Ante una partición de red hay que elegir…',
    score: 0.91,
  },
  {
    documento: 'notas-replicacion.md',
    texto: 'La mayoría de los sistemas eligen AP y…',
    score: 0.74,
  },
  {
    documento: 'apuntes-sistemas.pdf',
    texto: 'La tolerancia a particiones no es opcional…',
    score: 0.52,
  },
];

/* --- La demo simulada --- */

export const DEMO_PREGUNTA = '¿Qué dice el teorema CAP?';

/**
 * La respuesta, troceada como la emitiria el modelo. Los `[n]` se convierten
 * en citas pulsables; el numero tiene que existir en DEMO_FUENTES.
 */
export const DEMO_RESPUESTA =
  'Un sistema distribuido no puede garantizar a la vez consistencia, disponibilidad y tolerancia a particiones [1]. Ante una partición de red hay que elegir entre las dos primeras, y en la práctica la mayoría de los sistemas eligen disponibilidad y recuperan la consistencia más tarde [2].';

export const DEMO_FUENTES = [
  {
    nombre: 'manual-cap.pdf',
    detalle: 'Replicación › Teorema CAP · pág. 163',
    texto:
      'El teorema CAP establece que un sistema distribuido no puede garantizar simultáneamente consistencia, disponibilidad y tolerancia a particiones.',
  },
  {
    nombre: 'notas-replicacion.md',
    detalle: 'Consistencia eventual',
    texto:
      'En la práctica, la mayoría de los sistemas eligen AP y recuperan la consistencia más tarde, de forma eventual.',
  },
];

/** Milisegundos entre palabra y palabra de la demo. */
export const MS_POR_TOKEN = 55;

/* --- La seccion de la coleccion --- */

export const QUE_PREGUNTAR = {
  titulo: 'Qué puedes preguntar',
  entradilla:
    'El agente solo responde con lo que hay en tus documentos. Estas son las formas de pregunta que mejor aprovecha.',
  ejemplos: [
    {
      tipo: 'Definición',
      texto: 'Una idea concreta, con la cita del párrafo donde aparece.',
    },
    {
      tipo: 'Síntesis',
      texto: 'Un resumen de varias secciones, indicando de cuáles sale cada parte.',
    },
    {
      tipo: 'Comparación',
      texto: 'Dos conceptos cruzando documentos distintos, sin mezclar fuentes.',
    },
    {
      tipo: 'Localización',
      texto: 'Dónde se dice algo, con documento y página.',
    },
  ],
};

/** Los contadores de la columna derecha. `sufijo` admite cadena vacia. */
export const METRICAS = [
  { etiqueta: 'Documentos indexados', valor: 24, sufijo: '' },
  { etiqueta: 'Fragmentos en el índice', valor: 1840, sufijo: '' },
  { etiqueta: 'Formatos admitidos', valor: 6, sufijo: '' },
];

export const ULTIMA_ACTUALIZACION = 'Hace 2 horas';

/* ============================================================================
 * CONEXION CON LA API
 *
 *  1. METRICAS y ULTIMA_ACTUALIZACION
 *     Es lo unico que ahora mismo son numeros inventados en pantalla.
 *     `GET /documentos` ya devuelve `num_chunks` y `created_at` por documento:
 *       documentos indexados  -> documentos.length
 *       fragmentos en indice  -> suma de num_chunks
 *       ultima indexacion     -> max(created_at), con formatearFecha()
 *     En el proyecto sale con `obtenerDocumentos()` y el hook `useRecurso`.
 *
 *  2. PREGUNTAS_PLACEHOLDER y SUGERENCIAS
 *     Tienen que hablar de TUS documentos. Una pregunta generica aqui es una
 *     promesa que la aplicacion no cumple cuando el usuario la pulsa.
 *
 *  3. DEMO_PREGUNTA, DEMO_RESPUESTA y DEMO_FUENTES
 *     Lo mas rapido es lanzar una pregunta real contra `POST /preguntar`,
 *     copiar el texto que devuelve y pegar las fuentes del evento `fuentes`.
 *     Asi la demo es una respuesta de verdad congelada, no una redaccion.
 *
 *  4. FRAGMENTOS_EJEMPLO
 *     Los `score` deberian salir de una busqueda real. Ojo: el score del
 *     reordenador NO esta acotado a 0..1 y puede ser negativo; aqui se usan
 *     valores normalizados solo porque alimentan una barra de progreso.
 * ==========================================================================*/
