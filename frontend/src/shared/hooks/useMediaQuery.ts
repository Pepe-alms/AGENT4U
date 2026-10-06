import { useCallback, useSyncExternalStore } from 'react';

/**
 * Lee una media query desde JS. Se usa solo cuando el layout no se puede
 * resolver con CSS: aqui hace falta porque en movil los paneles son `<dialog>`
 * modales, y abrirlos exige llamar a `showModal()`, no cambiar una clase.
 *
 * Con `useSyncExternalStore` y no con `useState` + `useEffect`: matchMedia es
 * una fuente externa, y este hook es justo para lo que existe. De paso evita
 * el render en cascada de fijar el estado dentro del efecto.
 */
export function useMediaQuery(consulta: string): boolean {
  const suscribir = useCallback(
    (alCambiar: () => void) => {
      const lista = window.matchMedia(consulta);
      lista.addEventListener('change', alCambiar);
      return () => lista.removeEventListener('change', alCambiar);
    },
    [consulta],
  );

  return useSyncExternalStore(suscribir, () => window.matchMedia(consulta).matches);
}

/** Punto de ruptura unico, compartido con `AppShell.module.css`. */
export const CONSULTA_ESCRITORIO = '(min-width: 1024px)';
