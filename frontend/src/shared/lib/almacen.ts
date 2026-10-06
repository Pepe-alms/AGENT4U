/**
 * Acceso a `localStorage` que nunca lanza.
 *
 * Leer o escribir ahi tira una excepcion en ventana privada, con las cookies
 * bloqueadas o si no queda cuota. Cada sitio que lo use necesitaria su propio
 * try/catch, asi que vive aqui una sola vez: perder la preferencia es
 * aceptable, romper la aplicacion no.
 */
export function leerDelAlmacen(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

export function guardarEnAlmacen(clave: string, valor: string | null): void {
  try {
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch {
    // Sin persistencia la sesion sigue funcionando, solo no se recuerda.
  }
}
