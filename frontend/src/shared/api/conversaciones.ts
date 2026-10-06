import { peticion } from '@/shared/api/cliente';
import type {
  ConversacionDetalle,
  ConversacionEliminada,
  ConversacionResumen,
} from '@/shared/api/types';

/**
 * Las 20 mas recientes, ordenadas por `actualizada_en`. Devuelve lista vacia
 * si no hay ninguna, a diferencia de GET /documentos, que responde 404.
 * Contrato: backend/app/api/routers/conversations.py:17
 */
export function obtenerConversaciones(opciones: { signal?: AbortSignal } = {}) {
  return peticion<ConversacionResumen[]>('/conversaciones', opciones);
}

/** 404 si no existe. Los mensajes vienen del mas antiguo al mas reciente. */
export function obtenerConversacion(id: number, opciones: { signal?: AbortSignal } = {}) {
  return peticion<ConversacionDetalle>(`/conversaciones/${id}`, opciones);
}

export function eliminarConversacion(
  id: number,
  opciones: { signal?: AbortSignal } = {},
) {
  return peticion<ConversacionEliminada>(`/conversaciones/${id}`, {
    ...opciones,
    metodo: 'DELETE',
  });
}

/**
 * PATCH /conversaciones/{id}. Cambia el titulo.
 *
 * **No toca `actualizada_en`**, asi que la conversacion no sube al principio de
 * la lista: renombrar no cuenta como actividad.
 * Contrato: backend/app/api/routers/conversations.py
 */
export function renombrarConversacion(
  id: number,
  titulo: string,
  opciones: { signal?: AbortSignal } = {},
) {
  return peticion<ConversacionResumen>(`/conversaciones/${id}`, {
    ...opciones,
    metodo: 'PATCH',
    cuerpo: { titulo },
  });
}
