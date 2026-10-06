import { guardarEnAlmacen, leerDelAlmacen } from '@/shared/lib/almacen';

export type Valoracion = 'util' | 'inutil';

/**
 * Guarda si una respuesta ha gustado o no.
 *
 * Es una **interfaz** a proposito: el backend no tiene endpoint de feedback,
 * asi que hoy la unica implementacion escribe en `localStorage`. Cuando exista
 * el endpoint, basta con escribir otra implementacion y cambiar la que se usa;
 * nada del chat conoce donde se guarda esto.
 */
export type RepositorioValoraciones = {
  leer: (clave: string) => Valoracion | null;
  guardar: (clave: string, valoracion: Valoracion | null) => void;
};

/**
 * La valoracion se ancla a **la conversacion y la posicion del mensaje**, no al
 * id del objeto en memoria: los mensajes recien llegados tienen un id local
 * (un UUID) que al recargar se sustituye por el numerico del backend, asi que
 * una clave basada en el id perderia la valoracion en cuanto se refrescase.
 */
export function claveValoracion(conversacionId: number | null, indice: number): string {
  return `${conversacionId ?? 'sin-hilo'}:${indice}`;
}

const PREFIJO = 'agent4u:valoracion:';

function esValoracion(valor: unknown): valor is Valoracion {
  return valor === 'util' || valor === 'inutil';
}

/** Unica implementacion por ahora: el navegador. */
export const valoracionesLocales: RepositorioValoraciones = {
  leer(clave) {
    const guardado = leerDelAlmacen(PREFIJO + clave);
    return esValoracion(guardado) ? guardado : null;
  },

  guardar(clave, valoracion) {
    guardarEnAlmacen(PREFIJO + clave, valoracion);
  },
};
