import { guardarEnAlmacen, leerDelAlmacen } from '@/shared/lib/almacen';

const CLAVE = 'agent4u:ultima-pagina';
const POR_DEFECTO = '/home';

/**
 * La ultima pagina del sitio que se visito en esta sesion.
 *
 * Sirve para que el enlace de vuelta desde la aplicacion devuelva a donde
 * estabas y no siempre a la portada: si entraste desde Arquitectura, volver a
 * la portada te hace repetir el camino.
 *
 * Va en `sessionStorage` y no en `localStorage` a proposito: "la ultima pagina
 * que viste" deja de ser cierto mañana. Todo el acceso pasa por
 * `shared/lib/almacen.ts`, que nunca lanza.
 */
export function guardarUltimaPagina(ruta: string): void {
  guardarEnAlmacen(CLAVE, ruta, 'sesion');
}

/** Solo se devuelven rutas del sitio: una guardada corrupta no manda a /app. */
export function leerUltimaPagina(): string {
  const guardada = leerDelAlmacen(CLAVE, 'sesion');
  if (typeof guardada !== 'string') return POR_DEFECTO;
  if (!guardada.startsWith('/') || guardada.startsWith('//')) return POR_DEFECTO;
  if (guardada.startsWith('/app')) return POR_DEFECTO;
  return guardada;
}
