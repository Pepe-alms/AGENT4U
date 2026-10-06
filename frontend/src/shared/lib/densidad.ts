import { guardarEnAlmacen, leerDelAlmacen } from '@/shared/lib/almacen';

export type Densidad = 'comoda' | 'compacta';

const CLAVE = 'agent4u:densidad';

function esDensidad(valor: unknown): valor is Densidad {
  return valor === 'comoda' || valor === 'compacta';
}

export function leerDensidadGuardada(): Densidad {
  const guardado = leerDelAlmacen(CLAVE);
  return esDensidad(guardado) ? guardado : 'comoda';
}

export function guardarDensidad(densidad: Densidad): void {
  guardarEnAlmacen(CLAVE, densidad);
}

/**
 * La densidad solo aprieta el **espaciado**, mediante `--escala-densidad`.
 * Los tamanos minimos de los controles no escalan a proposito: encoger el area
 * pulsable de un boton es exactamente lo que no debe hacer un modo compacto.
 */
export function aplicarDensidad(densidad: Densidad): void {
  const raiz = document.documentElement;
  if (densidad === 'comoda') raiz.removeAttribute('data-densidad');
  else raiz.setAttribute('data-densidad', densidad);
}

export const ETIQUETA_DENSIDAD: Record<Densidad, string> = {
  comoda: 'Cómoda',
  compacta: 'Compacta',
};
