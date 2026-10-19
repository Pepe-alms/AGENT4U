import { peticion } from '@/shared/api/cliente';
import type { SaludBackend, SaludQdrant } from '@/shared/api/types';

export type EstadoQdrant = 'ok' | 'sin-coleccion' | 'error' | 'desconocido';

export type Salud = {
  backend: 'ok' | 'caido';
  qdrant: EstadoQdrant;
  /** Solo cuando se ha podido preguntar a Qdrant. */
  coleccion?: string;
  detalle?: string;
  /** Lo que tardo /health en contestar. Undefined si no contesto. */
  latenciaMs?: number;
};

/** Las sondas tienen que ser rapidas: si tardan, ya son una mala senal. */
const LIMITE_MS = 5_000;

/**
 * Dos preguntas en vez de una: si el backend no responde, el estado de Qdrant
 * es **desconocido**, no "caido". Decir que Qdrant esta mal cuando en realidad
 * no se ha podido preguntar seria mentir al usuario.
 */
export async function comprobarSalud(
  opciones: { signal?: AbortSignal } = {},
): Promise<Salud> {
  // Se cronometra solo /health: es la sonda barata y la que de verdad mide
  // el viaje de ida y vuelta. Incluir la de Qdrant mezclaria dos cosas.
  const arranque = performance.now();
  try {
    await peticion<SaludBackend>('/health', { ...opciones, tiempoLimiteMs: LIMITE_MS });
  } catch {
    return { backend: 'caido', qdrant: 'desconocido' };
  }
  const latenciaMs = Math.round(performance.now() - arranque);

  try {
    const qdrant = await peticion<SaludQdrant>('/health/qdrant', {
      ...opciones,
      tiempoLimiteMs: LIMITE_MS,
    });

    if (qdrant.status === 'error') {
      return {
        backend: 'ok',
        latenciaMs,
        qdrant: 'error',
        coleccion: qdrant.coleccion,
        detalle: qdrant.detalle ?? undefined,
      };
    }

    return {
      backend: 'ok',
      latenciaMs,
      // Qdrant responde pero la coleccion no existe: todavia no se ha indexado
      // nada. No es una averia, pero preguntar no va a devolver nada.
      qdrant: qdrant.existe ? 'ok' : 'sin-coleccion',
      coleccion: qdrant.coleccion,
    };
  } catch {
    return { backend: 'ok', latenciaMs, qdrant: 'desconocido' };
  }
}
