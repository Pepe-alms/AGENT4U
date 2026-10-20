import { peticionCruda } from '@/shared/api/cliente';
import { ErrorApi, MENSAJES } from '@/shared/api/errores';
import type { EventoSSE } from '@/shared/api/types';

export type PeticionPregunta = {
  query: string;
  /** Omitir para empezar un hilo nuevo; el id llega en el evento `inicio`. */
  conversacion_id?: number;
  /** Fragmentos que se pasan al modelo. Omitir para el defecto del servidor. */
  max_fragmentos?: number;
  /** Tiene que estar en los `modelos` de GET /ajustes. */
  modelo?: string;
};

/* Lista blanca: un evento que no este aqui se descarta. Al añadir uno nuevo
   en el backend hay que añadirlo tambien aqui, o se pierde en silencio. */
const TIPOS = ['inicio', 'paso', 'fuentes', 'texto', 'error', 'fin'] as const;

function esEventoSSE(valor: unknown): valor is EventoSSE {
  if (typeof valor !== 'object' || valor === null || !('tipo' in valor)) return false;
  return TIPOS.includes((valor as { tipo: unknown }).tipo as (typeof TIPOS)[number]);
}

/**
 * Convierte un bloque SSE en un evento, o en null si no lo es.
 *
 * Es una funcion **pura**: se puede probar sin red y sin React, que es lo que
 * la hace barata de verificar. Devuelve null en vez de lanzar ante un bloque
 * corrupto, porque un evento ilegible no debe tumbar el stream entero.
 */
export function parsearEventoSSE(bloque: string): EventoSSE | null {
  const linea = bloque.split('\n').find((l) => l.startsWith('data:'));
  if (!linea) return null;

  const json = linea.slice('data:'.length).trim();
  if (!json) return null;

  let valor: unknown;
  try {
    valor = JSON.parse(json);
  } catch {
    return null;
  }

  return esEventoSSE(valor) ? valor : null;
}

/**
 * POST /preguntar. Devuelve los eventos segun llegan.
 *
 * Orden garantizado por el backend: `inicio`, `fuentes`, N x `texto` y, para
 * cerrar, `fin` o `error`. Los `texto` son incrementales: hay que
 * concatenarlos. Un fallo del modelo llega como evento `error` **dentro de un
 * 200**, asi que quien consuma esto tiene que mirar los eventos, no el codigo.
 *
 * Sin tiempo limite: una respuesta larga puede tardar mucho mas que una
 * peticion normal. Para cortarla, `opciones.signal`.
 */
export async function* preguntar(
  cuerpo: PeticionPregunta,
  opciones: { signal?: AbortSignal } = {},
): AsyncGenerator<EventoSSE> {
  const respuesta = await peticionCruda('/preguntar', {
    metodo: 'POST',
    cuerpo,
    signal: opciones.signal,
    tiempoLimiteMs: 0,
  });

  if (!respuesta.body) {
    throw new ErrorApi(MENSAJES.respuesta, 'respuesta', respuesta.status);
  }

  const lector = respuesta.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;

      buffer += value;
      // Los eventos van separados por una linea en blanco. El ultimo trozo
      // puede estar cortado a la mitad, asi que se guarda para la vuelta
      // siguiente en vez de intentar parsearlo.
      const bloques = buffer.split('\n\n');
      buffer = bloques.pop() ?? '';

      for (const bloque of bloques) {
        const evento = parsearEventoSSE(bloque);
        if (evento) yield evento;
      }
    }

    const ultimo = parsearEventoSSE(buffer);
    if (ultimo) yield ultimo;
  } finally {
    await lector.cancel().catch(() => undefined);
  }
}
