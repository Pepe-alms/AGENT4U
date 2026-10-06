/**
 * Acceso a `localStorage` que nunca lanza.
 *
 * Leer o escribir ahi tira una excepcion en ventana privada, con las cookies
 * bloqueadas o si no queda cuota. Cada sitio que lo use necesitaria su propio
 * try/catch, asi que vive aqui una sola vez: perder la preferencia es
 * aceptable, romper la aplicacion no.
 */
/**
 * `'sesion'` usa `sessionStorage`, que se vacia al cerrar la pestaña. Es lo
 * correcto para lo que deja de ser cierto mañana, como "la ultima pagina que
 * estabas viendo".
 */
type Donde = 'local' | 'sesion';

function almacen(donde: Donde): Storage {
  return donde === 'sesion' ? sessionStorage : localStorage;
}

export function leerDelAlmacen(clave: string, donde: Donde = 'local'): string | null {
  try {
    return almacen(donde).getItem(clave);
  } catch {
    return null;
  }
}

export function guardarEnAlmacen(
  clave: string,
  valor: string | null,
  donde: Donde = 'local',
): void {
  try {
    if (valor === null) almacen(donde).removeItem(clave);
    else almacen(donde).setItem(clave, valor);
  } catch {
    // Sin persistencia la sesion sigue funcionando, solo no se recuerda.
  }
}
