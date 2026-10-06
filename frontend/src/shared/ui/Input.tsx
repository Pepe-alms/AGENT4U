import { useId, type InputHTMLAttributes } from 'react';

import { clases } from '@/shared/ui/clases';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  etiqueta: string;
  error?: string;
  /** Oculta la etiqueta visualmente, pero la mantiene para lectores de pantalla. */
  etiquetaOculta?: boolean;
};

/* Pildora con hairline y fondo transparente, como el resto de lo interactivo.
   El foco oscurece el hairline en vez de pintar un anillo de color. */
const CONTROL =
  'h-10 w-full rounded-full border border-borde bg-transparent px-5 text-base ' +
  'text-texto placeholder:text-tenue transition-colors ' +
  'focus:border-borde-fuerte focus:outline-none disabled:opacity-40';

export function Input({
  etiqueta,
  error,
  etiquetaOculta = false,
  id,
  className,
  ...resto
}: Props) {
  const idGenerado = useId();
  const idCampo = id ?? idGenerado;
  const idError = `${idCampo}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={idCampo}
        className={etiquetaOculta ? 'solo-lectores' : 'text-[0.8125rem] text-suave'}
      >
        {etiqueta}
      </label>
      <input
        {...resto}
        id={idCampo}
        className={clases(CONTROL, error && 'border-error', className)}
        aria-invalid={error ? true : undefined}
        // Solo apunta al error si existe: un aria-describedby colgando de un
        // id que no esta en el DOM no lo lee nadie.
        aria-describedby={error ? idError : undefined}
      />
      {error ? (
        <span id={idError} className="text-[0.75rem] text-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
