import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { vecinas } from '@/routes';

/**
 * El pie de recorrido de cada pagina.
 *
 * Sale del orden de `routes.ts`, que es el mismo de la barra: si la barra dice
 * que Arquitectura va antes que Tecnologias, esto no puede decir otra cosa.
 *
 * Cuando falta un lado, el otro se queda en su extremo con `justify-between`
 * y un hueco: un boton "Anterior" deshabilitado no informa de nada.
 */
export function AnteriorSiguiente({ id }: { id: string }) {
  const { anterior, siguiente } = vecinas(id);
  if (!anterior && !siguiente) return null;

  const enlace =
    'group flex flex-col gap-1 rounded-m border border-borde p-5 transition-colors hover:bg-superficie-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto';

  return (
    <nav
      aria-label="Recorrido del sitio"
      className="flex gap-4 border-t border-borde py-10"
    >
      {anterior ? (
        <Link to={anterior.path} rel="prev" className={`${enlace} flex-1`}>
          <span className="flex items-center gap-1.5 text-[0.8125rem] text-tenue">
            <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
            Anterior
          </span>
          <span className="text-[1.0625rem] font-medium">{anterior.label}</span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}

      {siguiente ? (
        <Link
          to={siguiente.path}
          rel="next"
          className={`${enlace} flex-1 items-end text-end`}
        >
          <span className="flex items-center gap-1.5 text-[0.8125rem] text-tenue">
            Siguiente
            <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <span className="text-[1.0625rem] font-medium">{siguiente.label}</span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
    </nav>
  );
}
