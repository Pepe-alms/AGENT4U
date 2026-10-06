import { useId } from 'react';

import type { FormaCover, PaletaCover } from '@/sitio/tipos';

/**
 * La portada de una tarjeta o de una pagina.
 *
 * Es **el unico sitio del sistema donde entra el color**. Todo lo demas es
 * monocromo, asi que una portada no compite con nada: es lo que mira el ojo
 * primero y lo unico que necesita mirar.
 *
 * Mientras no haya fotografia real, se pinta en codigo: un degradado de dos o
 * tres manchas difuminadas, una capa de grano y, opcionalmente, una forma
 * geometrica fina que representa el tema. En cuanto haya foto, se pasa `src` y
 * este componente se aparta sin que nada mas cambie.
 */

// Se reexportan para que quien use <Cover> no tenga que saber de `tipos.ts`.
export type { FormaCover, PaletaCover };

/**
 * Las paletas. Suaves y luminosas salvo `grafito`, que es la de los temas
 * tecnicos y es la unica que no aporta color: ahi la portada es textura.
 */
const PALETAS: Record<PaletaCover, [string, string, string]> = {
  amanecer: ['#ff9a5a', '#ffd29a', '#fff1e0'],
  lavanda: ['#b8a6ff', '#e3dcff', '#f6f3ff'],
  oceano: ['#7fb8ff', '#cfe5ff', '#eef6ff'],
  menta: ['#8fe3c2', '#d6f5e8', '#f1fbf6'],
  grafito: ['#2a2a2a', '#5a5a5a', '#9a9a9a'],
};

type Props = {
  variante: PaletaCover;
  /** La forma fina en blanco. Representa el tema; `ninguna` deja solo el mesh. */
  forma?: FormaCover;
  /** 16:9 en tarjetas grandes y cabeceras, 4:3 en las pequeñas. */
  ratio?: '16/9' | '4/3';
  /**
   * Una imagen de verdad. Cuando llegue, sustituye al SVG sin tocar nada mas:
   * mismo recorte, mismo radio, mismo comportamiento al pasar el raton.
   */
  src?: string;
  /** Obligatorio si hay `src`. Con el SVG generado la portada es decorativa. */
  alt?: string;
  className?: string;
};

const RATIO: Record<NonNullable<Props['ratio']>, string> = {
  '16/9': 'aspect-[16/9]',
  '4/3': 'aspect-[4/3]',
};

/** La forma geometrica fina. Trazo blanco, nunca relleno. */
function Forma({ forma }: { forma: FormaCover }) {
  if (forma === 'ninguna') return null;

  const trazo = {
    stroke: 'rgb(255 255 255 / 55%)',
    strokeWidth: 1,
    fill: 'none',
    vectorEffect: 'non-scaling-stroke' as const,
  };

  if (forma === 'nodos') {
    return (
      <g {...trazo}>
        <path d="M120 150 L300 90 M300 90 L480 150 M300 90 L300 230 M120 150 L300 230 M480 150 L300 230" />
        {[
          [120, 150],
          [300, 90],
          [480, 150],
          [300, 230],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="7" />
        ))}
      </g>
    );
  }

  if (forma === 'capas') {
    return (
      <g {...trazo}>
        {[0, 34, 68].map((dy) => (
          <path
            key={dy}
            d={`M180 ${110 + dy} L300 ${80 + dy} L420 ${110 + dy} L300 ${140 + dy} Z`}
          />
        ))}
      </g>
    );
  }

  if (forma === 'rejilla') {
    return (
      <g {...trazo}>
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`v${i}`} x1={180 + i * 48} y1="80" x2={180 + i * 48} y2="260" />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={`h${i}`} x1="180" y1={80 + i * 45} x2="420" y2={80 + i * 45} />
        ))}
      </g>
    );
  }

  return (
    <g {...trazo}>
      {[0, 26, 52].map((dy) => (
        <path
          key={dy}
          d={`M100 ${150 + dy} Q 180 ${110 + dy} 260 ${150 + dy} T 420 ${150 + dy} T 580 ${150 + dy}`}
        />
      ))}
    </g>
  );
}

export function Cover({
  variante,
  forma = 'ninguna',
  ratio = '16/9',
  src,
  alt,
  className,
}: Props) {
  /*
   * Los ids de los filtros SVG son globales al documento: dos portadas con el
   * mismo id comparten filtro y la segunda hereda el desenfoque de la primera.
   * `useId` da uno distinto por instancia.
   */
  const id = useId().replace(/:/g, '');
  const [a, b, c] = PALETAS[variante];

  const marco = [
    'relative overflow-hidden rounded-m bg-superficie-suave',
    RATIO[ratio],
    className ?? '',
  ].join(' ');

  if (src) {
    return (
      <div className={marco}>
        <img
          src={src}
          alt={alt ?? ''}
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform duration-400 ease-out group-hover:scale-[1.03]"
        />
      </div>
    );
  }

  return (
    <div className={marco}>
      <svg
        viewBox="0 0 600 338"
        preserveAspectRatio="xMidYMid slice"
        className="size-full transition-transform duration-400 ease-out group-hover:scale-[1.03]"
        // Decorativa: lo que cuenta la seccion esta en el titular de al lado,
        // y describir un degradado no le sirve a nadie.
        aria-hidden="true"
      >
        <defs>
          <filter id={`mancha-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="60" />
          </filter>
          {/*
            El grano. `baseFrequency` alta da un ruido fino; bajarla haria
            manchas y parecerian artefactos de compresion.
          */}
          <filter id={`grano-${id}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" />
          </filter>
        </defs>

        <rect width="600" height="338" fill={c} />

        <g filter={`url(#mancha-${id})`}>
          <ellipse className="deriva-1" cx="160" cy="110" rx="190" ry="150" fill={a} />
          <ellipse className="deriva-2" cx="470" cy="230" rx="200" ry="160" fill={b} />
          <ellipse
            className="deriva-3"
            cx="330"
            cy="60"
            rx="150"
            ry="120"
            fill={a}
            opacity="0.7"
          />
        </g>

        <Forma forma={forma} />

        <rect
          width="600"
          height="338"
          filter={`url(#grano-${id})`}
          opacity="0.08"
          style={{ mixBlendMode: 'overlay' }}
        />
      </svg>
    </div>
  );
}
