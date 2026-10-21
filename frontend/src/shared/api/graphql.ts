import { peticion, type OpcionesPeticion } from '@/shared/api/cliente';
import { ErrorApi, MENSAJES } from '@/shared/api/errores';

type ErrorGraphQL = {
  message: string;
  extensions?: { status?: number };
};

type RespuestaGraphQL<T> = {
  data: T | null;
  errors?: ErrorGraphQL[];
};

type OpcionesGraphQL = Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>;

/**
 * Unico punto de entrada a POST /graphql del gateway.
 *
 * Un error GraphQL llega con HTTP 200 dentro de `errors`, no como un codigo de
 * fallo: `extensions.status` es lo que lleva el codigo original del backend
 * (409, 429, 404), igual que antes viajaba en la respuesta HTTP directa.
 */
export async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>,
  opciones: OpcionesGraphQL = {},
): Promise<T> {
  const respuesta = await peticion<RespuestaGraphQL<T>>('/graphql', {
    ...opciones,
    metodo: 'POST',
    cuerpo: variables ? { query, variables } : { query },
  });

  const [error] = respuesta.errors ?? [];
  if (error) {
    throw new ErrorApi(error.message, 'http', error.extensions?.status);
  }

  if (respuesta.data === null || respuesta.data === undefined) {
    throw new ErrorApi(MENSAJES.respuesta, 'respuesta');
  }

  return respuesta.data;
}
