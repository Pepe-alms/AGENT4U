import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { clases } from '@/shared/ui/clases';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Obligatorio: un boton sin texto necesita nombre accesible. */
  etiqueta: string;
  icono: ReactNode;
  conBorde?: boolean;
};

/*
 * 28px de caja. Es menos de los 44px que recomienda la guia tactil, y es
 * deliberado: estos botones viven en barras densas de escritorio. Los que de
 * verdad se pulsan con el dedo (enviar, abrir panel) son `Button` o llevan su
 * propio tamaño.
 *
 * `aria-pressed` se pasa desde fuera cuando el boton es un interruptor; aqui
 * solo se estila, porque el significado lo pone quien lo usa.
 */
const BASE =
  'inline-grid size-8 shrink-0 place-items-center rounded-full text-suave ' +
  'transition-[background-color,color] duration-150 ' +
  'hover:bg-superficie-suave hover:text-texto ' +
  'disabled:pointer-events-none disabled:opacity-40 ' +
  // Pulsado = el icono se enciende sobre un tinte muy leve. Sin relleno de
  // color: convertiria el estado mas trivial de la barra en lo mas llamativo
  // de la pantalla, y ademas no hay color de marca con el que hacerlo.
  'aria-pressed:bg-superficie-suave aria-pressed:text-texto';

export function IconButton({
  etiqueta,
  icono,
  conBorde = false,
  className,
  ...resto
}: Props) {
  return (
    <button
      type="button"
      {...resto}
      className={clases(BASE, conBorde && 'border border-borde', className)}
      aria-label={etiqueta}
    >
      {icono}
    </button>
  );
}
