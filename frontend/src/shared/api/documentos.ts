import { peticion } from '@/shared/api/cliente';
import { ErrorApi } from '@/shared/api/errores';
import { graphql } from '@/shared/api/graphql';
import type {
  Documento,
  DocumentoEliminado,
  FicheroEncolado,
  TrabajoEncolado,
  TrabajoEstado,
} from '@/shared/api/types';

const QUERY_DOCUMENTOS = `{
  documentos {
    id origin name type size created_at state num_chunks error_message
  }
}`;

/**
 * query { documentos }. El resolver del gateway ya absorbe el 404 que manda
 * el backend cuando no hay ninguno: aqui "sin documentos" es, directamente,
 * una lista vacia.
 */
export async function obtenerDocumentos(
  opciones: { signal?: AbortSignal } = {},
): Promise<Documento[]> {
  const { documentos } = await graphql<{ documentos: Documento[] }>(
    QUERY_DOCUMENTOS,
    undefined,
    opciones,
  );
  return documentos;
}

const MUTATION_ELIMINAR_DOCUMENTO = `
  mutation($nombre: String!) {
    eliminar_documento(nombre: $nombre) { status documento }
  }
`;

/**
 * mutation { eliminar_documento }. El parametro es el **nombre** del
 * documento, no su id. Hay dos desenlaces con status 200: hay que mirar
 * `status`, no si la mutation lanzo error.
 */
export async function eliminarDocumento(
  nombre: string,
  opciones: { signal?: AbortSignal } = {},
): Promise<DocumentoEliminado> {
  const { eliminar_documento: resultado } = await graphql<{
    eliminar_documento: DocumentoEliminado;
  }>(MUTATION_ELIMINAR_DOCUMENTO, { nombre }, opciones);
  return resultado;
}

/**
 * Extensiones que el backend sabe convertir. No las valida él (acepta
 * cualquier etiqueta en `type`), así que el filtro vive aquí para no mandar a
 * indexar algo que va a fallar a mitad de la ingesta.
 */
export const EXTENSIONES = ['pdf', 'docx', 'md', 'txt', 'html'] as const;

/** `type` se deriva de la extensión; el backend solo la propaga al payload. */
export function tipoDeRuta(ruta: string): string {
  const extension = ruta.split('.').pop()?.toLowerCase() ?? '';
  return extension && extension.length <= 5 ? extension : 'txt';
}

const MUTATION_INDEXAR = `
  mutation($filePath: String!, $type: String!) {
    indexar(file_path: $filePath, type: $type) { job_id status }
  }
`;

/**
 * mutation { indexar }. Encola la indexacion y devuelve el job_id.
 *
 * La ruta es única: reindexar la misma lanza un error con `estado` 409.
 */
export async function indexarFichero(
  rutaServidor: string,
  opciones: { signal?: AbortSignal } = {},
): Promise<TrabajoEncolado> {
  const { indexar } = await graphql<{ indexar: TrabajoEncolado }>(
    MUTATION_INDEXAR,
    { filePath: rutaServidor, type: tipoDeRuta(rutaServidor) },
    opciones,
  );
  return indexar;
}

const MUTATION_INDEXAR_URL = `
  mutation($url: String!) {
    indexar_url(url: $url) { job_id status }
  }
`;

/** mutation { indexar_url }. Encola la indexacion de una pagina web. */
export async function indexarUrl(
  url: string,
  opciones: { signal?: AbortSignal } = {},
): Promise<TrabajoEncolado> {
  const { indexar_url: resultado } = await graphql<{ indexar_url: TrabajoEncolado }>(
    MUTATION_INDEXAR_URL,
    { url },
    opciones,
  );
  return resultado;
}

/** Techo del cliente, en bytes. El backend aplica el suyo (APP_UPLOAD_MAX_BYTES). */
export const TAMANO_MAXIMO = 50 * 1024 * 1024;

/**
 * POST /indexar-fichero. Sube el fichero y encola su indexacion.
 *
 * Se queda en REST: es el proxy multipart del gateway, no pasa por GraphQL.
 * El nombre que viaja es el del fichero elegido; el backend se queda solo con
 * su último componente, así que no puede escribir fuera de su carpeta de
 * subidas. La ruta final llega en la respuesta.
 */
export function subirFichero(
  fichero: File,
  opciones: { signal?: AbortSignal } = {},
): Promise<FicheroEncolado> {
  const formulario = new FormData();
  formulario.append('fichero', fichero, fichero.name);

  return peticion<FicheroEncolado>('/indexar-fichero', {
    metodo: 'POST',
    cuerpo: formulario,
    signal: opciones.signal,
  });
}

const QUERY_TRABAJO = `
  query($jobId: String!) {
    trabajo(job_id: $jobId) {
      job_id status origin name num_chunks error_message
    }
  }
`;

/**
 * query { trabajo }. Consulta el estado de una indexacion encolada.
 *
 * El resolver devuelve `null` si el job no existe; aqui se traduce a un
 * ErrorApi con `estado` 404, igual que antes viajaba el codigo HTTP, para que
 * el sondeo de useIngesta.ts siga reintentando sin cambios.
 */
export async function obtenerEstadoTrabajo(
  jobId: string,
  opciones: { signal?: AbortSignal } = {},
): Promise<TrabajoEstado> {
  const { trabajo } = await graphql<{ trabajo: TrabajoEstado | null }>(
    QUERY_TRABAJO,
    { jobId },
    opciones,
  );
  if (trabajo === null) {
    throw new ErrorApi('Trabajo no encontrado.', 'http', 404);
  }
  return trabajo;
}

/** Qué se puede subir, por extensión. El backend no valida la lista. */
export function extensionAdmitida(nombre: string): boolean {
  return (EXTENSIONES as readonly string[]).includes(tipoDeRuta(nombre));
}
