import { peticion } from '@/shared/api/cliente';
import type { AjustesServidor } from '@/shared/api/types';

/**
 * GET /ajustes. Que parametros acepta el servidor.
 *
 * Se piden en vez de codificarlos aqui para no duplicar los limites: si el
 * backend cambia su tope o su lista de modelos, la interfaz se entera sola.
 */
export function obtenerAjustesServidor(opciones: { signal?: AbortSignal } = {}) {
  return peticion<AjustesServidor>('/ajustes', opciones);
}
