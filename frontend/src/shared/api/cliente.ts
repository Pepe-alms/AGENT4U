import { ErrorApi, MENSAJES } from '@/shared/api/errores';

const BASE_URL: string = import.meta.env.VITE_API_URL;

/** Suficiente para una consulta normal; el stream de /preguntar usa el suyo. */
const TIEMPO_LIMITE_MS = 15_000;

export type OpcionesPeticion = {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
  signal?: AbortSignal;
  /** 0 para desactivar el limite (streams largos). */
  tiempoLimiteMs?: number;
};

function combinarSenales(
  externa: AbortSignal | undefined,
  tiempoLimiteMs: number,
): { signal: AbortSignal | undefined; limpiar: () => void } {
  if (tiempoLimiteMs <= 0) return { signal: externa, limpiar: () => {} };

  const porTiempo = AbortSignal.timeout(tiempoLimiteMs);
  if (!externa) return { signal: porTiempo, limpiar: () => {} };

  return { signal: AbortSignal.any([externa, porTiempo]), limpiar: () => {} };
}

/**
 * Unico punto por el que sale una peticion al backend. Centraliza la URL base,
 * el tiempo limite, la cancelacion y la traduccion de fallos a `ErrorApi`.
 *
 * Una cancelacion pedida por quien llama NO se convierte en ErrorApi: se
 * relanza el AbortError original para que el llamante pueda ignorarlo.
 */
export async function peticionCruda(
  ruta: string,
  opciones: OpcionesPeticion = {},
): Promise<Response> {
  const { metodo = 'GET', cuerpo, signal, tiempoLimiteMs = TIEMPO_LIMITE_MS } = opciones;
  const { signal: senal } = combinarSenales(signal, tiempoLimiteMs);

  let respuesta: Response;
  try {
    // Un FormData se manda tal cual y SIN cabecera: el navegador tiene que
    // poner el `boundary` del multipart, y fijar Content-Type a mano lo
    // rompería.
    const esFormulario = cuerpo instanceof FormData;

    respuesta = await fetch(`${BASE_URL}${ruta}`, {
      method: metodo,
      signal: senal,
      headers:
        cuerpo === undefined || esFormulario
          ? undefined
          : { 'Content-Type': 'application/json' },
      body:
        cuerpo === undefined ? undefined : esFormulario ? cuerpo : JSON.stringify(cuerpo),
    });
  } catch (error) {
    // El llamante cancelo a proposito: no es un fallo, se propaga tal cual.
    if (signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ErrorApi(MENSAJES.tiempo, 'tiempo');
    }
    throw new ErrorApi(MENSAJES.red, 'red');
  }

  if (!respuesta.ok) {
    throw new ErrorApi(await mensajeHttp(respuesta), 'http', respuesta.status);
  }

  return respuesta;
}

/** Como `peticionCruda`, pero devolviendo el JSON ya parseado. */
export async function peticion<T>(
  ruta: string,
  opciones: OpcionesPeticion = {},
): Promise<T> {
  const respuesta = await peticionCruda(ruta, opciones);

  try {
    return (await respuesta.json()) as T;
  } catch {
    throw new ErrorApi(MENSAJES.respuesta, 'respuesta', respuesta.status);
  }
}

/**
 * El backend manda los fallos como `{"detail": "..."}` (ErrorOut).
 *
 * Ese `detail` se usa solo en los 4xx, donde esta escrito para el usuario
 * ("Conversación no encontrada"). En los 5xx es un fallo interno y su texto
 * suele ser tecnico o inutil, asi que se sustituye por un mensaje propio: al
 * usuario le sirve mas saber que el fallo es del servidor que leer el volcado.
 */
async function mensajeHttp(respuesta: Response): Promise<string> {
  if (respuesta.status >= 500) {
    return `El servidor ha fallado al procesar la petición (${respuesta.status}).`;
  }

  try {
    const cuerpo: unknown = await respuesta.json();
    if (
      typeof cuerpo === 'object' &&
      cuerpo !== null &&
      'detail' in cuerpo &&
      typeof cuerpo.detail === 'string'
    ) {
      return cuerpo.detail;
    }
  } catch {
    // Sin cuerpo util: se cae al mensaje generico de abajo.
  }
  return `${MENSAJES.http} (${respuesta.status})`;
}
