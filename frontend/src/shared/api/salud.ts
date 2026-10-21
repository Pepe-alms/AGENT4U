import { graphql } from '@/shared/api/graphql';
import type { SaludQdrant } from '@/shared/api/types';

export type EstadoQdrant = 'ok' | 'sin-coleccion' | 'error' | 'desconocido';

export type Salud = {
  backend: 'ok' | 'caido';
  qdrant: EstadoQdrant;
  /** Solo cuando se ha podido preguntar a Qdrant. */
  coleccion?: string;
  detalle?: string;
  /** Lo que tardo la consulta combinada. Undefined si no contesto. */
  latenciaMs?: number;
};

/** La sonda tiene que ser rapida: si tarda, ya es una mala senal. */
const LIMITE_MS = 5_000;

const QUERY_SALUD = `{
  salud {
    backend
    qdrant { status coleccion existe detalle }
  }
}`;

type RespuestaSalud = {
  salud: { backend: string; qdrant: SaludQdrant };
};

/**
 * query { salud }. Una unica consulta que combina lo que antes eran dos
 * peticiones (`/health` y `/health/qdrant`): el resolver del gateway las hace
 * por nosotros, asi que un fallo de red tumba ambas a la vez. Es justo lo
 * mismo que pasaba antes si el backend estaba caido, asi que el resultado no
 * cambia: solo que ya no se puede cronometrar `/health` por separado.
 */
export async function comprobarSalud(
  opciones: { signal?: AbortSignal } = {},
): Promise<Salud> {
  const arranque = performance.now();

  let respuesta: RespuestaSalud;
  try {
    respuesta = await graphql<RespuestaSalud>(QUERY_SALUD, undefined, {
      ...opciones,
      tiempoLimiteMs: LIMITE_MS,
    });
  } catch {
    return { backend: 'caido', qdrant: 'desconocido' };
  }

  const latenciaMs = Math.round(performance.now() - arranque);
  const { qdrant } = respuesta.salud;

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
}
