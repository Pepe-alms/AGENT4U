import { useEffect, useRef, useState } from 'react';

import {
  Link,
  NavLink,
  Outlet,
  ScrollRestoration,
  useLocation,
  useMatches,
} from 'react-router';

import { Sello } from '@/shared/ui/Logo';
import { BotonMenu, DialogoMenu } from '@/sitio/componentes/MenuMovil';
import {
  LEYENDA_PIE,
  PRODUCTO,
  RUTA_APP,
  RUTAS_NAV,
  rutaPorId,
  tituloDocumento,
} from '@/routes';

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto';

/** Lo que cada ruta cuelga de su `handle` para que el layout lo lea. */
export type HandleRuta = { id: string };

/**
 * Pone el `<title>` y la meta description de la ruta activa.
 *
 * Los dos salen de `routes.ts`. Escribirlos en cada pagina es como se acaba
 * con dos paginas que comparten titulo y con una description que se quedo de
 * un copiar y pegar.
 */
function useMetadatos(id: string | undefined) {
  useEffect(() => {
    const ruta = id ? rutaPorId(id) : undefined;
    if (!ruta) return;

    document.title = tituloDocumento(ruta.title);

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.append(meta);
    }
    meta.content = ruta.description;
  }, [id]);
}

/**
 * Tras navegar, el foco va al `<h1>` de la nueva pagina.
 *
 * Sin esto, quien navega con teclado o lector de pantalla se queda con el foco
 * en el enlace que acaba de pulsar, en una pagina que ya no existe: el
 * siguiente Tab sigue por la barra y nunca llega al contenido.
 *
 * No se hace en la primera carga: ahi el foco ya esta donde debe (el inicio
 * del documento) y robarlo saltaria el enlace de "Saltar al contenido".
 */
function useFocoEnTitular(pathname: string) {
  const primeraCarga = useRef(true);

  useEffect(() => {
    if (primeraCarga.current) {
      primeraCarga.current = false;
      return;
    }
    // El h1 se pinta en la misma pasada, pero las paginas diferidas llegan
    // despues: se busca en el siguiente fotograma.
    const cuadro = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('main h1')?.focus();
    });
    return () => cancelAnimationFrame(cuadro);
  }, [pathname]);
}

function BarraSitio({
  menuAbierto,
  onAbrirMenu,
}: {
  menuAbierto: boolean;
  onAbrirMenu: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 bg-fondo/90 backdrop-blur-sm">
      <nav
        className="mx-auto flex h-16 max-w-[1200px] items-center gap-4 px-4 sm:px-6"
        aria-label="Principal"
      >
        {/* `Link` y no `NavLink`: es la marca, no un elemento de la
            navegacion. Como NavLink marcaba `aria-current="page"` en /home y
            dejaba DOS "pagina actual" en la misma barra. */}
        <Link
          to="/home"
          className={`flex shrink-0 items-center gap-2 rounded-s text-[0.9375rem] font-medium tracking-[-0.01em] ${FOCO}`}
        >
          <Sello tamano={20} />
          {PRODUCTO}
        </Link>

        {/* La barra completa solo desde `md`. Por debajo manda el menu. */}
        <ul className="hidden min-w-0 flex-1 items-center gap-1 md:flex">
          {RUTAS_NAV.map((ruta) => (
            <li key={ruta.id}>
              <NavLink
                to={ruta.path}
                // `end` solo en la portada: sin el, /home marcaria activo en
                // todas las rutas. En las demas se quiere lo contrario, que la
                // ruta hija marque activo a su padre.
                end={ruta.path === '/home'}
                className={({ isActive }) =>
                  [
                    'block rounded-full px-3 py-2 text-[0.875rem] font-medium whitespace-nowrap transition-colors',
                    FOCO,
                    isActive
                      ? 'text-texto underline decoration-1 underline-offset-[6px]'
                      : 'text-suave hover:bg-superficie-suave hover:text-texto',
                  ].join(' ')
                }
              >
                {ruta.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <span className="flex-1 md:hidden" />

        {/* La aplicacion es otro arbol: `<a>` y no `<Link>` a proposito, para
            que el router del sitio no intente montarla dentro del layout. */}
        <a
          href={RUTA_APP}
          className={`hidden shrink-0 rounded-full bg-acento px-5 py-2 text-[0.875rem] font-medium whitespace-nowrap text-sobre-acento transition-colors hover:bg-acento-hover md:block ${FOCO}`}
        >
          Abrir el agente
        </a>

        <BotonMenu abierto={menuAbierto} onAbrir={onAbrirMenu} />
      </nav>
    </header>
  );
}

function PieSitio() {
  return (
    <footer className="border-t border-borde">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-[0.8125rem] text-tenue">
          {PRODUCTO} · {LEYENDA_PIE}
        </p>
        <ul className="flex flex-wrap gap-4">
          {RUTAS_NAV.map((ruta) => (
            <li key={ruta.id}>
              <NavLink
                to={ruta.path}
                className={`rounded-s text-[0.8125rem] text-tenue transition-colors hover:text-texto ${FOCO}`}
              >
                {ruta.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}

/**
 * El marco comun del sitio: barra, contenido y pie.
 *
 * El ancho maximo y el margen lateral viven aqui y no en cada pagina, que es
 * lo que hace que paginas distintas se lean como la misma publicacion.
 */
export function Sitio() {
  const { pathname } = useLocation();
  const matches = useMatches();
  const [menuAbierto, setMenuAbierto] = useState(false);

  // El `handle` de la ruta mas profunda que lo declare: con
  // /arquitectura/:componente manda la hija, no el padre.
  const id = [...matches].reverse().find((m) => (m.handle as HandleRuta | undefined)?.id);
  const idRuta = (id?.handle as HandleRuta | undefined)?.id;

  useMetadatos(idRuta);
  useFocoEnTitular(pathname);

  return (
    <div className="min-h-dvh bg-fondo text-texto">
      {/*
        Primera parada de tabulacion. Sin esto hay que atravesar la barra
        entera en cada pagina para llegar al contenido. Solo se ve al recibir
        el foco.
      */}
      <a
        href="#contenido"
        className="absolute -top-40 start-4 z-40 rounded-full border border-texto bg-superficie px-5 py-2.5 text-sm font-medium text-texto transition-[top] focus:top-4"
      >
        Saltar al contenido
      </a>

      {/*
        Vuelve arriba al navegar y restaura la posicion con atras y adelante.
        Lo trae el router: hacerlo a mano con un `scrollTo(0)` en cada cambio
        de ruta rompe justamente el atras, que es cuando mas se nota.
      */}
      <ScrollRestoration />

      <BarraSitio menuAbierto={menuAbierto} onAbrirMenu={() => setMenuAbierto(true)} />

      {/* Fuera de la barra: sus enlaces tambien marcan `aria-current`. */}
      <DialogoMenu abierto={menuAbierto} onCerrar={() => setMenuAbierto(false)} />

      <main id="contenido" className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <Outlet />
      </main>

      <PieSitio />
    </div>
  );
}
