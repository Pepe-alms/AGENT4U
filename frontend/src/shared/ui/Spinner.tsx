type Props = {
  tamano?: 'sm' | 'md';
  /** Texto para lectores de pantalla. Omitelo si el contenedor ya lo anuncia. */
  etiqueta?: string;
};

const TAMANO = { sm: 'size-3.5', md: 'size-5' } as const;

export function Spinner({ tamano = 'md', etiqueta }: Props) {
  return (
    <>
      <svg
        className={`${TAMANO[tamano]} shrink-0 motion-safe:animate-spin`}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2.5"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {etiqueta ? <span className="solo-lectores">{etiqueta}</span> : null}
    </>
  );
}
