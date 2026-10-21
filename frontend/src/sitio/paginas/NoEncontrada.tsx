import { Link, useLocation } from 'react-router';

import { Revelar } from '@/sitio/componentes/Revelar';
import { RUTAS_NAV } from '@/routes';
import { useScrollToHash } from '@/sitio/useScrollToHash';

/**
 * La 404.
 *
 * No es un callejon: dice que ruta se pidio, lista las secciones que SI
 * existen y deja la portada a un clic. Una 404 con solo "no encontrado"
 * obliga a volver con el boton de atras, que es pedirle al usuario que
 * arregle el problema por su cuenta.
 */
function NoEncontrada() {
  // El ancla del hash, con la pagina ya montada: ver useScrollToHash.
  useScrollToHash();

  const { pathname } = useLocation();

  return (
    <>
      <header className="flex flex-col gap-4 pt-16 pb-4">
        <Revelar>
          <p className="text-[0.8125rem] font-medium text-tenue">Error 404</p>
        </Revelar>
        <Revelar indice={1}>
          {/* `tabIndex` para que el foco pueda aterrizar aqui al navegar. */}
          <h1
            tabIndex={-1}
            className="max-w-[18ch] text-[clamp(2.25rem,1.6rem+2.6vw,3rem)] leading-[1.16] font-medium tracking-[-0.03em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-texto"
          >
            Esta página no existe
          </h1>
        </Revelar>
        <Revelar indice={2}>
          <p className="max-w-[58ch] text-suave">
            No hay nada en{' '}
            <code className="rounded-s bg-superficie-suave px-1.5 py-0.5 font-mono text-[0.9375rem]">
              {pathname}
            </code>
            . Puede que el enlace esté mal escrito o que la sección ya no esté.
          </p>
        </Revelar>
      </header>

      <section className="flex flex-col gap-6 py-10">
        <Revelar indice={3}>
          <p className="text-[0.875rem] font-medium text-suave">Secciones del sitio</p>
        </Revelar>

        {/* Lista directa: con tres secciones, un campo de busqueda es mas
            estorbo que ayuda —hay que escribir para ver lo que ya cabe entero
            en pantalla—. Si el sitio pasa de ocho, se replantea. */}
        <ul className="flex flex-col gap-3">
          {RUTAS_NAV.map((ruta, indice) => (
            <Revelar key={ruta.id} indice={indice + 4} como="li">
              <Link
                to={ruta.path}
                className="flex flex-col gap-1 rounded-m border border-borde p-5 transition-colors hover:bg-superficie-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
              >
                <span className="text-[1.0625rem] font-medium">{ruta.label}</span>
                <span className="text-[0.9375rem] text-suave">{ruta.description}</span>
              </Link>
            </Revelar>
          ))}
        </ul>
      </section>

      <section className="border-t border-borde py-10">
        <Link
          to="/home"
          className="inline-flex rounded-full bg-acento px-5 py-2.5 text-[0.875rem] font-medium text-sobre-acento transition-colors hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
        >
          Ir a Inicio
        </Link>
      </section>
    </>
  );
}

export default NoEncontrada;
