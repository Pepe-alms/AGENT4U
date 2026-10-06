import { useCallback } from 'react';

import { useSinMovimiento } from '@/shared/hooks/useMediaQuery';

/**
 * Las props del revelado al hacer scroll: fade y 8px, nada mas.
 *
 * El hook se llama UNA vez por componente y devuelve una funcion, para poder
 * usarla dentro de un `.map()`: llamar al hook en un bucle seria romper las
 * reglas de los hooks.
 *
 * `indice` escalona la entrada 60ms por elemento. Se limita a 8 porque a
 * partir de ahi el ultimo de una lista larga esperaria medio segundo a
 * aparecer, y eso ya no se lee como entrada sino como lentitud.
 *
 * Con movimiento reducido devuelve `{}`: el elemento se pinta en su estado
 * final, sin `initial` ni `whileInView`.
 *
 * Existe para que haya UNA sola decision sobre el movimiento reducido. Cuando
 * cada sitio se guardaba su propia copia de estas props, el pipeline de la
 * portada se quedo con los cinco pasos INVISIBLES para quien pide menos
 * movimiento, y nadie lo vio hasta que una auditoria los conto.
 */
export function useRevelado() {
  const sinMovimiento = useSinMovimiento();

  return useCallback(
    (indice = 0) =>
      sinMovimiento
        ? {}
        : {
            initial: { opacity: 0, y: 8 },
            whileInView: { opacity: 1, y: 0 },
            viewport: { once: true, margin: '-60px' },
            transition: {
              duration: 0.4,
              ease: [0, 0, 0.2, 1] as const,
              delay: Math.min(indice, 8) * 0.06,
            },
          },
    [sinMovimiento],
  );
}
