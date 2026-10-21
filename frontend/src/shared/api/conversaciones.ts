import { ErrorApi } from '@/shared/api/errores';
import { graphql } from '@/shared/api/graphql';
import type {
  ConversacionDetalle,
  ConversacionEliminada,
  ConversacionResumen,
} from '@/shared/api/types';

const QUERY_CONVERSACIONES = `{
  conversaciones { id titulo creada_en actualizada_en }
}`;

/**
 * query { conversaciones }. Las 20 mas recientes, ordenadas por
 * `actualizada_en`. Lista vacia si no hay ninguna.
 */
export async function obtenerConversaciones(
  opciones: { signal?: AbortSignal } = {},
): Promise<ConversacionResumen[]> {
  const { conversaciones } = await graphql<{ conversaciones: ConversacionResumen[] }>(
    QUERY_CONVERSACIONES,
    undefined,
    opciones,
  );
  return conversaciones;
}

const QUERY_CONVERSACION = `
  query($id: Int!) {
    conversacion(id: $id) {
      id titulo creada_en actualizada_en
      mensajes {
        id rol contenido creado_en
        fuentes { nombre origen headings paginas texto score subconsulta }
      }
    }
  }
`;

/**
 * query { conversacion }. Los mensajes vienen del mas antiguo al mas
 * reciente. El resolver devuelve `null` si no existe; se traduce a un
 * ErrorApi con `estado` 404, igual que antes viajaba el codigo HTTP.
 */
export async function obtenerConversacion(
  id: number,
  opciones: { signal?: AbortSignal } = {},
): Promise<ConversacionDetalle> {
  const { conversacion } = await graphql<{ conversacion: ConversacionDetalle | null }>(
    QUERY_CONVERSACION,
    { id },
    opciones,
  );
  if (conversacion === null) {
    throw new ErrorApi('Conversación no encontrada', 'http', 404);
  }
  return conversacion;
}

const MUTATION_ELIMINAR_CONVERSACION = `
  mutation($id: Int!) {
    eliminar_conversacion(id: $id) { status id }
  }
`;

export async function eliminarConversacion(
  id: number,
  opciones: { signal?: AbortSignal } = {},
): Promise<ConversacionEliminada> {
  const { eliminar_conversacion: resultado } = await graphql<{
    eliminar_conversacion: ConversacionEliminada;
  }>(MUTATION_ELIMINAR_CONVERSACION, { id }, opciones);
  return resultado;
}

const MUTATION_RENOMBRAR_CONVERSACION = `
  mutation($id: Int!, $titulo: String!) {
    renombrar_conversacion(id: $id, titulo: $titulo) {
      id titulo creada_en actualizada_en
    }
  }
`;

/**
 * mutation { renombrar_conversacion }. Cambia el titulo.
 *
 * **No toca `actualizada_en`**, asi que la conversacion no sube al principio
 * de la lista: renombrar no cuenta como actividad.
 */
export async function renombrarConversacion(
  id: number,
  titulo: string,
  opciones: { signal?: AbortSignal } = {},
): Promise<ConversacionResumen> {
  const { renombrar_conversacion: resultado } = await graphql<{
    renombrar_conversacion: ConversacionResumen;
  }>(MUTATION_RENOMBRAR_CONVERSACION, { id, titulo }, opciones);
  return resultado;
}
