import type { AccionResolver } from '@/shared/api/types';

/** 0.756 → «76 %». Redondeado: la decision no depende del decimal. */
export function porcentaje(proporcion: number | null | undefined): string {
  return `${Math.round((proporcion ?? 0) * 100)} %`;
}

/**
 * Los dos sentidos del parecido, dichos de forma que se entiendan sin saber
 * como se calcula: cuanto del nuevo ya estaba, y cuanto del antiguo sigue.
 * Con los dos se distingue una version nueva (los dos altos) de un extracto
 * (el primero alto, el segundo bajo) o de una ampliacion (al reves).
 */
export function textoParecido(
  nombreAntiguo: string,
  nuevoEnAntiguo: number | null | undefined,
  antiguoEnNuevo: number | null | undefined,
): string {
  return (
    `Se parece a «${nombreAntiguo}»: el ${porcentaje(nuevoEnAntiguo)} de este ya está ` +
    `en aquel, y el ${porcentaje(antiguoEnNuevo)} de aquel está en este.`
  );
}

export const ACCIONES: { accion: AccionResolver; etiqueta: string; ayuda: string }[] = [
  {
    accion: 'reemplazar',
    etiqueta: 'Reemplazar',
    ayuda: 'Borra el antiguo e indexa este en su lugar.',
  },
  {
    accion: 'conservar',
    etiqueta: 'Conservar los dos',
    ayuda: 'Indexa este y deja el antiguo.',
  },
  {
    accion: 'descartar',
    etiqueta: 'Descartar',
    ayuda: 'Elimina este; el antiguo se queda.',
  },
];
