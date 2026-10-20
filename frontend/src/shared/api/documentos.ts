import { peticion } from '@/shared/api/cliente';
import { ErrorApi } from '@/shared/api/errores';
import type {
  Documento,
  DocumentoEliminado,
  FicheroEncolado,
  TrabajoEncolado,
  TrabajoEstado,
} from '@/shared/api/types';

type RespuestaLista = { documentos: Documento[] };

/**
 * OJO: el backend responde **404 cuando no hay ningun documento**, no una lista
 * vacia (backend/app/api/schemas.py:143). Esa rareza se absorbe aqui para que
 * ninguna vista tenga que saberlo: "no hay documentos" es una lista vacia.
 */
export async function obtenerDocumentos(
  opciones: { signal?: AbortSignal } = {},
): Promise<Documento[]> {
  try {
    const respuesta = await peticion<RespuestaLista>('/documentos', opciones);
    return respuesta.documentos;
  } catch (error) {
    if (error instanceof ErrorApi && error.estado === 404) return [];
    throw error;
  }
}

/**
 * El parametro es el **nombre** del documento, no su id. Hay dos desenlaces con
 * codigo 200: hay que mirar `status`, no el codigo HTTP.
 */
export function eliminarDocumento(
  nombre: string,
  opciones: { signal?: AbortSignal } = {},
) {
  return peticion<DocumentoEliminado>(`/documentos/${encodeURIComponent(nombre)}`, {
    ...opciones,
    metodo: 'DELETE',
  });
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

/**
 * POST /indexar. Encola la indexacion y devuelve 202 con el job_id.
 *
 * La ruta es única: reindexar la misma devuelve 409.
 */
export function indexarFichero(
  rutaServidor: string,
  opciones: { signal?: AbortSignal } = {},
): Promise<TrabajoEncolado> {
  return peticion<TrabajoEncolado>('/indexar', {
    metodo: 'POST',
    cuerpo: { file_path: rutaServidor, type: tipoDeRuta(rutaServidor) },
    signal: opciones.signal,
  });
}

/** POST /indexar-url. Encola la indexacion y devuelve 202. */
export function indexarUrl(
  url: string,
  opciones: { signal?: AbortSignal } = {},
): Promise<TrabajoEncolado> {
  return peticion<TrabajoEncolado>('/indexar-url', {
    metodo: 'POST',
    cuerpo: { url },
    signal: opciones.signal,
  });
}

/** Techo del cliente, en bytes. El backend aplica el suyo (APP_UPLOAD_MAX_BYTES). */
export const TAMANO_MAXIMO = 50 * 1024 * 1024;

/**
 * POST /indexar-fichero. Sube el fichero y encola su indexacion.
 *
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

/** GET /trabajos/{jobId}. Consulta el estado de una indexacion encolada. */
export function obtenerEstadoTrabajo(
  jobId: string,
  opciones: { signal?: AbortSignal } = {},
): Promise<TrabajoEstado> {
  return peticion<TrabajoEstado>(`/trabajos/${encodeURIComponent(jobId)}`, opciones);
}

/** Qué se puede subir, por extensión. El backend no valida la lista. */
export function extensionAdmitida(nombre: string): boolean {
  return (EXTENSIONES as readonly string[]).includes(tipoDeRuta(nombre));
}
