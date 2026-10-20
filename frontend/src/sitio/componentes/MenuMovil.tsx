import { useEffect, useRef } from 'react';

import { NavLink, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';

import { RUTA_APP, RUTAS_NAV } from '@/routes';

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto';

/**
 * El boton y el panel van SEPARADOS, y no es un capricho de organizacion:
 *
 *   - El boton vive dentro de `<nav aria-label="Principal">`, donde esta el
 *     resto de la barra.
 *   - El panel vive FUERA. Sus enlaces tambien marcan `aria-current="page"`,
 *     y dentro de la barra dejaban TRES elementos diciendo "esta es la pagina
 *     actual" en la misma navegacion. Lo cazo la prueba que los cuenta.
 *
 * El foco vuelve al boton al cerrar, y se localiza por `id` en vez de pasarse
 * una `ref` entre tres componentes: el ref viajando por props obliga a leerlo
 * durante el render, que es justo lo que no hay que hacer con un ref.
 */
const ID_BOTON = 'boton-menu-movil';

export function BotonMenu({
  abierto,
  onAbrir,
}: {
  abierto: boolean;
  onAbrir: () => void;
}) {
  return (
    <button
      id={ID_BOTON}
      type="button"
      onClick={onAbrir}
      aria-expanded={abierto}
      aria-controls="menu-movil"
      aria-label="Abrir el menú de navegación"
      className={`grid size-9 shrink-0 place-items-center rounded-full text-suave transition-colors hover:bg-superficie-suave hover:text-texto md:hidden ${FOCO}`}
    >
      <Menu size={20} strokeWidth={1.5} />
    </button>
  );
}

/**
 * El panel de navegacion por debajo de 768px.
 *
 * Es un `<dialog>` con `showModal()` y no un panel a medida, por lo mismo que
 * los paneles de la aplicacion: el foco atrapado, el cierre con Escape y el
 * fondo inerte los trae el navegador. Reimplementar una trampa de foco a mano
 * es justo donde fallan estos componentes.
 */
export function DialogoMenu({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  // El evento 'close' se escucha en el DOM y no con la prop `onClose`: no
  // burbujea, y si no llega a React el padre se queda creyendo que sigue
  // abierto. A partir de ahi el boton no vuelve a abrirlo nunca.
  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;

    const alCerrar = () => {
      onCerrar();
      // Devolver el foco al disparador cierra el circulo para quien navega con
      // teclado: si no, el foco cae al principio del documento.
      document.getElementById(ID_BOTON)?.focus();
    };

    d.addEventListener('close', alCerrar);
    return () => d.removeEventListener('close', alCerrar);
  }, [onCerrar]);

  // Navegar cierra el menu. Va por `pathname` y no por el `onClick` de cada
  // enlace: asi tambien se cierra si la navegacion viene de otro sitio.
  useEffect(() => {
    const d = dialogo.current;
    if (d?.open) d.close();
  }, [pathname]);

  return (
    <dialog
      ref={dialogo}
      id="menu-movil"
      aria-label="Navegación"
      className="fixed inset-x-0 top-0 hidden max-h-dvh w-full max-w-none flex-col bg-superficie p-0 text-texto backdrop:bg-black/25 backdrop:backdrop-blur-sm open:flex"
    >
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <span className="text-[0.875rem] font-medium text-suave">Navegación</span>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar el menú"
          className={`grid size-9 place-items-center rounded-full text-suave transition-colors hover:bg-superficie-suave hover:text-texto ${FOCO}`}
        >
          <X size={20} strokeWidth={1.5} />
        </button>
      </div>

      <ul className="flex flex-col gap-1 px-3 pb-6">
        {RUTAS_NAV.map((ruta) => (
          <li key={ruta.id}>
            <NavLink
              to={ruta.path}
              end={ruta.path === '/home'}
              className={({ isActive }) =>
                [
                  'block rounded-m px-3 py-3 text-[1.0625rem] transition-colors',
                  FOCO,
                  isActive
                    ? 'bg-superficie-suave font-medium text-texto underline decoration-1 underline-offset-4'
                    : 'text-suave',
                ].join(' ')
              }
            >
              {ruta.label}
            </NavLink>
          </li>
        ))}
        <li className="mt-3 px-3">
          {/* La aplicacion es otro arbol: `<a>` a proposito. */}
          <a
            href={RUTA_APP}
            className={`block rounded-full bg-acento px-5 py-3 text-center text-[0.9375rem] font-medium text-sobre-acento ${FOCO}`}
          >
            Abrir el agente
          </a>
        </li>
      </ul>
    </dialog>
  );
}
