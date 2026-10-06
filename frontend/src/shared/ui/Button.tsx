import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { clases } from '@/shared/ui/clases';
import { Spinner } from '@/shared/ui/Spinner';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: 'primario' | 'secundario' | 'fantasma';
  tamano?: 'sm' | 'md';
  cargando?: boolean;
  children: ReactNode;
};

/* Pildora, siempre. Es la firma geometrica del sistema y tiene que ser
   consistente entre botones, chips y campos. */
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium ' +
  'transition-[background-color,border-color,color] duration-150 ' +
  'disabled:pointer-events-none disabled:opacity-40';

/*
 * Tres pesos, y el relleno es el escaso:
 *
 *   primario   -> relleno en negro. Es la UNICA pieza rellena de la pantalla,
 *                 como un punto final. Rellenar cualquier otro boton diluye
 *                 esa señal hasta dejarla sin valor.
 *   secundario -> pildora con hairline y fondo transparente.
 *   fantasma   -> solo texto, con un tinte al pasar por encima.
 */
const VARIANTE = {
  primario: 'bg-acento text-sobre-acento hover:bg-acento-hover',
  secundario: 'border border-borde text-texto hover:bg-superficie-suave',
  fantasma: 'text-suave hover:bg-superficie-suave hover:text-texto',
} as const;

// Alturas fijas en rem: no escalan con la densidad, porque encoger el area
// pulsable es justo lo que no debe hacer un modo compacto.
// 8px vertical / 20px horizontal, que es la proporcion de la guia.
const TAMANO = {
  sm: 'h-8 px-4 text-[0.8125rem]',
  md: 'h-10 px-5 text-sm',
} as const;

export function Button({
  variante = 'primario',
  tamano = 'md',
  cargando = false,
  disabled,
  className,
  children,
  ...resto
}: Props) {
  return (
    <button
      type="button"
      {...resto}
      className={clases(BASE, VARIANTE[variante], TAMANO[tamano], className)}
      disabled={disabled ?? cargando}
      aria-busy={cargando || undefined}
    >
      {cargando ? <Spinner tamano="sm" /> : null}
      {children}
    </button>
  );
}
