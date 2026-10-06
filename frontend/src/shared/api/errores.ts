/** Por que fallo una peticion. El codigo de la UI decide que pintar segun esto. */
export type TipoErrorApi =
  /** El servidor respondio con un codigo >= 400. `estado` tiene el codigo. */
  | 'http'
  /** No hubo respuesta: servidor caido, DNS o CORS. */
  | 'red'
  /** Se agoto el tiempo limite del cliente. */
  | 'tiempo'
  /** El cuerpo no era el JSON esperado. */
  | 'respuesta';

export class ErrorApi extends Error {
  readonly tipo: TipoErrorApi;
  readonly estado: number | undefined;

  constructor(mensaje: string, tipo: TipoErrorApi, estado?: number) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.tipo = tipo;
    this.estado = estado;
  }
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
};

/** Convierte cualquier cosa lanzada en un mensaje que se le puede ensenar al usuario. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorApi) return error.message;
  if (error instanceof Error) return error.message;
  return MENSAJES.respuesta;
}
