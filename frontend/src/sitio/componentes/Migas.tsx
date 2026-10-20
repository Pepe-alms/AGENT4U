import { Fragment } from 'react';

import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

import { migasDe } from '@/routes';

/**
 * Migas de pan, generadas a partir de `parent` en el mapa de rutas.
 *
 * La ultima no es un enlace: lleva a donde ya estas, y un enlace que no va a
 * ningun sitio es una promesa rota pequeña pero repetida en cada pagina.
 *
 * No se pintan en la portada: una sola miga que dice "Inicio" estando en
 * Inicio no orienta a nadie.
 */
export function Migas({ id }: { id: string }) {
  const cadena = migasDe(id);
  if (cadena.length < 2) return null;

  return (
    <nav aria-label="Migas de pan" className="pt-8">
      <ol className="flex flex-wrap items-center gap-1 text-[0.8125rem]">
        {cadena.map((ruta, indice) => {
          const ultima = indice === cadena.length - 1;

          return (
            <Fragment key={ruta.id}>
              {indice > 0 ? (
                <li aria-hidden="true" className="flex items-center text-tenue">
                  <ChevronRight size={14} strokeWidth={1.5} />
                </li>
              ) : null}
              <li>
                {ultima ? (
                  <span aria-current="page" className="text-texto">
                    {ruta.label}
                  </span>
                ) : (
                  <Link
                    to={ruta.path}
                    className="rounded-s text-tenue transition-colors hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
                  >
                    {ruta.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
