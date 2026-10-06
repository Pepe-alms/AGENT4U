import type { ReactNode } from 'react';

import { useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';

/**
 * El revelado al hacer scroll: fade y 8px, nada mas.
 *
 * `indice` escalona la entrada 60ms por elemento. Se limita a 8 porque a
 * partir de ahi el ultimo de una lista larga esperaria medio segundo a
 * aparecer, y eso ya no se lee como entrada sino como lentitud.
 *
 * `como="li"` NO es un detalle de estilo: dentro de un `<ul>`, envolver cada
 * elemento en un `<div>` rompe la semantica de lista —el `<ul>` deja de
 * contener `<li>` directos— y un lector de pantalla pierde "lista de 6
 * elementos, elemento 1 de 6". Lo encontro axe-core.
 */
export function Revelar({
  children,
  indice = 0,
  className,
  como = 'div',
}: {
  children: ReactNode;
  indice?: number;
  className?: string;
  como?: 'div' | 'li';
}) {
  const sinMovimiento = useReducedMotion();

  /*
   * Con movimiento reducido NO se anima: se pinta el estado final.
   *
   * No es solo accesibilidad. Un revelado que desplaza 8px cada elemento al
   * entrar en pantalla hace que todo lo que esta debajo se mueva mientras
   * alguien intenta pulsarlo. Para una persona es un temblor de 400ms; para
   * una prueba automatica es un elemento que nunca se estabiliza, y ahi es
   * donde se ve que el problema existe.
   */
  const animacion = sinMovimiento
    ? { className }
    : {
        initial: { opacity: 0, y: 8 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: '-60px' },
        transition: {
          duration: 0.4,
          ease: [0, 0, 0.2, 1] as const,
          delay: Math.min(indice, 8) * 0.06,
        },
        className,
      };

  if (como === 'li') return <m.li {...animacion}>{children}</m.li>;
  return <m.div {...animacion}>{children}</m.div>;
}
