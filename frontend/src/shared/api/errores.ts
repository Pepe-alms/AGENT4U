/** Por que fallo una peticion. El codigo de la UI decide que pintar segun esto. */
export type TipoErrorApi =
  /** El servidor respondio con un codigo >= 400. `estado` tiene el codigo. */
  | 'http'
  /** No hubo respuesta: servidor caido, DNS o CORS. */
  | 'red'
  /** Se agoto el tiempo limite del cliente. */
  | 'tiempo'
  /** El cuerpo no era el JSON esperado. */
  | 'respuesta'
  /**
   * La aplicacion esta mal construida: no sabe a que backend hablar.
   *
   * No es un fallo de red ni del servidor, y por eso tiene su propio tipo: no
   * se arregla reintentando ni esperando, hay que volver a construir el bundle
   * con `VITE_API_URL`.
   */
  | 'configuracion';

export class ErrorApi extends Error {
  readonly tipo: TipoErrorApi;
  readonly estado: number | undefined;
  /**
   * El resto del cuerpo del error, ademas del mensaje: lo que el backend
   * manda junto a `detail` (REST) o en `extensions` (GraphQL). El 409 de
   * "mismo fichero" trae aqui `motivo` y `duplicado_de`.
   */
  readonly datos: Record<string, unknown>;

  constructor(
    mensaje: string,
    tipo: TipoErrorApi,
    estado?: number,
    datos: Record<string, unknown> = {},
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.tipo = tipo;
    this.estado = estado;
    this.datos = datos;
  }
}

/**
 * Si el error es el rechazo del nivel 1 (exactamente el mismo fichero que un
 * documento que ya existe), ese documento. null en cualquier otro caso.
 */
export function mismoFicheroQue(
  error: unknown,
): { id: number; name: string; state: string } | null {
  if (!(error instanceof ErrorApi) || error.datos.motivo !== 'mismo-fichero') return null;
  const original = error.datos.duplicado_de;
  if (typeof original !== 'object' || original === null) return null;
  const { id, name, state } = original as Record<string, unknown>;
  return typeof id === 'number' && typeof name === 'string'
    ? { id, name, state: typeof state === 'string' ? state : '' }
    : null;
}

/**
 * Mensajes por defecto, en espanol y accionables. El nativo de `fetch`
 * ("Failed to fetch") no le dice nada a nadie.
 */
export const MENSAJES: Record<TipoErrorApi, string> = {
  red: 'No se pudo conectar con el servidor. ¿Está arrancado el backend?',
  tiempo: 'El servidor ha tardado demasiado en responder.',
  respuesta: 'El servidor ha devuelto una respuesta que no se entiende.',
  http: 'La petición ha fallado.',
  configuracion:
    'La aplicación está mal configurada: no sabe a qué servidor dirigirse. ' +
    'Falta la variable VITE_API_URL al construirla.',
};

/** Convierte cualquier cosa lanzada en un mensaje que se le puede ensenar al usuario. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorApi) return error.message;
  if (error instanceof Error) return error.message;
  return MENSAJES.respuesta;
}
