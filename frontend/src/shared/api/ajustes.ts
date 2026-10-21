import { graphql } from '@/shared/api/graphql';
import type { AjustesServidor } from '@/shared/api/types';

const QUERY = `{
  ajustes {
    modelos
    max_fragmentos_defecto
    max_fragmentos_tope
    max_indexaciones_en_vuelo
  }
}`;

/**
 * query { ajustes }. Que parametros acepta el servidor.
 *
 * Se piden en vez de codificarlos aqui para no duplicar los limites: si el
 * backend cambia su tope o su lista de modelos, la interfaz se entera sola.
 */
export async function obtenerAjustesServidor(
  opciones: { signal?: AbortSignal } = {},
): Promise<AjustesServidor> {
  const { ajustes } = await graphql<{ ajustes: AjustesServidor }>(
    QUERY,
    undefined,
    opciones,
  );
  return ajustes;
}
