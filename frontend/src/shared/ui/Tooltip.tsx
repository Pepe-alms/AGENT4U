import { useId, type ReactNode } from 'react';

type Props = {
  texto: string;
  children: ReactNode;
};

/**
 * Aparece con el raton y con el teclado (`focus-within`). El texto se asocia
 * con `aria-describedby`, asi que el lector de pantalla lo lee aunque la
 * burbuja este oculta visualmente.
 */
export function Tooltip({ texto, children }: Props) {
  const id = useId();

  return (
    <span className="group/tip relative inline-flex">
      <span aria-describedby={id}>{children}</span>
      {/* `invisible` y no `hidden`: tiene que seguir en el arbol para que
          aria-describedby lo encuentre. */}
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none invisible absolute top-[calc(100%+0.4rem)] left-1/2 z-30 w-max max-w-56 -translate-x-1/2 rounded-s border border-borde-fuerte bg-superficie px-2 py-1.5 text-[0.6875rem] leading-snug text-balance text-suave opacity-0 shadow-l transition-[opacity,visibility] duration-150 group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100"
      >
        {texto}
      </span>
    </span>
  );
}
