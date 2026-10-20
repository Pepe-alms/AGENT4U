/**
 * La marca de AGENT4U.
 *
 * El simbolo es una hoja con tres renglones, el del medio recortado y marcado
 * con un punto. Es literalmente lo que hace el producto —de toda la pagina,
 * este fragmento, y aqui esta la cita— y por eso no es un monograma
 * intercambiable: significa algo.
 *
 * Va **monocromo**, en `currentColor`. No es solo una preferencia: el sistema
 * no tiene color de marca, asi que una marca que se apoya en su forma es la
 * unica que encaja.
 *
 * SVG y no imagen a proposito: pesa menos de 1 kB, no hace una peticion, se
 * mantiene nitido a cualquier tamaño, hereda el color del tema y sirve igual
 * de favicon.
 */

type Props = {
  /** Lado del sello en px. El trazo se ajusta solo. */
  tamano?: number;
  className?: string;
};

/** Solo el sello, sin el nombre. Para la cabecera y el favicon. */
export function Sello({ tamano = 28, className }: Props) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 28 28"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* La hoja, con la esquina doblada. Hereda `currentColor`, asi que es
          del color del texto en los dos temas sin una sola regla extra. */}
      <path
        d="M6.5 3.75h8.25L21.5 10.5v13.75a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1V4.75a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 3.75V10.5h7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />

      {/* Tres renglones. El del medio es mas corto: es el fragmento citado. */}
      <path
        d="M9 14.5h9M9 18h5M9 21.5h7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.45"
      />

      {/* El marcador de la cita, al final del renglon recortado. Va solido
          frente a los renglones al 45%: es el contraste de peso lo que lo
          señala, porque el sistema no tiene color de marca. */}
      <circle cx="16.6" cy="18" r="1.7" fill="currentColor" />
    </svg>
  );
}
