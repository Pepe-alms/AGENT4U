/**
 * Espejo de backend/app/api/schemas.py. Los nombres de campo se dejan tal cual
 * los manda el backend, aunque mezclen idiomas: traducirlos aqui obligaria a
 * mantener un mapeo y a dudar de cual es el nombre bueno.
 */

export type Fuente = {
  nombre: string;
  origen: string;
  headings: string[];
  paginas: number[];
  /** El fragmento recuperado. Cadena vacia en mensajes guardados antes de
   *  que el backend empezara a mandarlo. */
  texto?: string;
  /**
   * Relevancia que le dio el reordenador. **No esta acotada a 0..1 y puede ser
   * negativa**: solo sirve para comparar fragmentos entre si dentro de una
   * misma respuesta, nunca como porcentaje. null si no se registro.
   */
  score?: number | null;
  /** La consulta derivada que encontro el fragmento, que con multiconsulta no
   *  es la que escribio el usuario. */
  subconsulta?: string;
};

export type Rol = 'user' | 'assistant';

export type Mensaje = {
  id: number;
  rol: Rol;
  contenido: string;
  /** Siempre null en los mensajes de rol 'user'. Puede ser [] en los de 'assistant'. */
  fuentes: Fuente[] | null;
  creado_en: string;
};

export type ConversacionResumen = {
  id: number;
  titulo: string;
  creada_en: string;
  actualizada_en: string;
};

export type ConversacionDetalle = ConversacionResumen & {
  mensajes: Mensaje[];
};

export type ConversacionEliminada = {
  status: 'eliminada';
  id: number;
};

export type EstadoDocumento =
  'en-cola' | 'indexando' | 'pendiente' | 'indexado' | 'error';

export type Documento = {
  id: number;
  origin: string;
  /** Es la clave que usa DELETE /documentos/{documento}, no el id. */
  name: string;
  type: string;
  size: number | null;
  created_at: string;
  state: EstadoDocumento;
  num_chunks: number;
  error_message: string | null;
};

export type DocumentoEliminado = {
  /** Dos desenlaces con HTTP 200: hay que mirar este campo, no el codigo. */
  status: 'eliminado' | 'fallo en el borrado';
  documento: string;
};

export type TrabajoEncolado = {
  job_id: string;
  status: 'en-cola';
};

/** Respuesta de POST /indexar-fichero: lo mismo, mas donde quedo el fichero. */
export type FicheroEncolado = TrabajoEncolado & { ruta: string };

/** Respuesta de GET /trabajos/{job_id}. */
export type TrabajoEstado = {
  job_id: string;
  status: EstadoDocumento;
  origin: string;
  name: string;
  num_chunks: number;
  error_message: string | null;
};

/* --- Eventos del stream de POST /preguntar --- */

export type EventoInicio = { tipo: 'inicio'; conversacion_id: number };

/** Nodos del grafo del backend (app/rag/grafo/grafo_create.py). */
export type NodoAgente =
  | 'reformular'
  | 'multiconsulta'
  | 'buscar'
  | 'fusionar'
  | 'evaluar'
  | 'reescribir'
  | 'construir';

/**
 * Un nodo del grafo que acaba de terminar. El backend manda hechos y la
 * interfaz pone las palabras: aqui no viene ningun texto para el usuario.
 *
 * Llega **despues** de que el paso termine, nunca antes: `updates` de LangGraph
 * no avisa de que algo empieza. Por eso no hay estado 'en curso' en el evento.
 */
export type EventoPaso = {
  tipo: 'paso';
  nodo: NodoAgente | (string & {});
  /** Lo que tardo ese nodo. */
  ms: number;
  fragmentos?: number;
  subconsultas?: number;
  score?: number;
  pobre?: boolean;
  intento?: number;
};
export type EventoFuentes = { tipo: 'fuentes'; fuentes: Fuente[] };
export type EventoTexto = { tipo: 'texto'; texto: string };
export type EventoError = { tipo: 'error'; mensaje: string };
export type EventoFin = { tipo: 'fin' };

/**
 * Orden garantizado: `inicio`, N x `paso` mientras corre el grafo, `fuentes`,
 * N x `texto` y, para cerrar, `fin` o `error`. Los `texto` son incrementales:
 * hay que concatenarlos.
 */
export type EventoSSE =
  EventoInicio | EventoPaso | EventoFuentes | EventoTexto | EventoError | EventoFin;

/* --- Ajustes --- */

/** Respuesta de GET /ajustes: lo que el cliente puede tocar. */
export type AjustesServidor = {
  /** El primero es el de por defecto. */
  modelos: string[];
  max_fragmentos_defecto: number;
  max_fragmentos_tope: number;
  /** Peticiones de indexacion que el servidor acepta a la vez antes del 429. */
  max_indexaciones_en_vuelo: number;
};

/* --- Salud --- */

export type SaludBackend = { status: 'ok' };

/**
 * OJO: `GET /health/qdrant` responde **200 aunque Qdrant este caido**. Hay que
 * mirar `status`, no el codigo HTTP, igual que en DELETE /documentos.
 */
export type SaludQdrant = {
  status: 'ok' | 'error';
  coleccion: string;
  existe: boolean;
  detalle: string | null;
};
