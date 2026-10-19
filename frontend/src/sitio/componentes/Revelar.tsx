import type { ReactNode } from 'react';

import * as m from 'motion/react-m';

import { useRevelado } from '@/sitio/useRevelado';

/**
 * El envoltorio que revela su contenido al entrar en pantalla.
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
  const revelar = useRevelado();
  const animacion = { ...revelar(indice), className };

  if (como === 'li') return <m.li {...animacion}>{children}</m.li>;
  return <m.div {...animacion}>{children}</m.div>;
}
