import { Link } from 'react-router';

import { Cover, type FormaCover, type PaletaCover } from '@/sitio/componentes/Cover';

/**
 * La tarjeta de articulo del sitio.
 *
 * **No lleva marco ni fondo**, y es deliberado: la tarjeta la definen su
 * portada y su bloque de texto, con el aire alrededor haciendo de separador.
 * Un hairline rodeandolo todo convertiria una revista en un panel de control.
 * Los hairlines se reservan para las tarjetas de dato —tecnologias, metricas—,
 * donde si hay que acotar una caja.
 *
 * El enlace envuelve la tarjeta entera y no solo el titulo: media tarjeta
 * pulsable y media no es un objetivo de clic, es una trampa.
 */

export type DatosArticulo = {
  eyebrow: string;
  titulo: string;
  entradilla: string;
  href: string;
  paleta: PaletaCover;
  forma?: FormaCover;
  /** Imagen real, cuando la haya. El componente la prefiere al SVG generado. */
  src?: string;
};

type Props = DatosArticulo & {
  /** `lg` lleva portada 16:9 y titular de subtitular; `sm`, 4:3 y mas chico. */
  size?: 'lg' | 'sm';
  className?: string;
};

export function ArticleCard({
  eyebrow,
  titulo,
  entradilla,
  href,
  paleta,
  forma = 'ninguna',
  src,
  size = 'sm',
  className,
}: Props) {
  const grande = size === 'lg';

  return (
    <Link
      to={href}
      className={[
        'group flex flex-col gap-4 rounded-m focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-texto',
        className ?? '',
      ].join(' ')}
    >
      <Cover
        variante={paleta}
        forma={forma}
        ratio={grande ? '16/9' : '4/3'}
        src={src}
        alt=""
      />

      <div className="flex flex-col gap-2">
        <p className="text-[0.8125rem] font-medium text-tenue">{eyebrow}</p>
        <h3
          className={
            grande
              ? 'text-[clamp(1.375rem,1.1rem+1vw,1.5rem)] font-medium tracking-[-0.02em]'
              : 'text-[1.0625rem] font-medium tracking-[-0.01em]'
          }
        >
          {titulo}
        </h3>
        <p className={`text-suave ${grande ? 'max-w-[52ch]' : 'text-[0.9375rem]'}`}>
          {entradilla}
        </p>
      </div>
    </Link>
  );
}
