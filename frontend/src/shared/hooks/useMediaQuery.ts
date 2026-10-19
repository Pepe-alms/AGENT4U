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

/** Quien pide menos movimiento. */
export const CONSULTA_SIN_MOVIMIENTO = '(prefers-reduced-motion: reduce)';

/**
 * Si el usuario pide menos movimiento.
 *
 * Se usa esto y NO el `useReducedMotion` de Motion cuando la respuesta decide
 * que props se le pasan a un componente animado. El de Motion devuelve `null`
 * en el primer render y `true` despues, asi que ese primer render aplica
 * `initial: { opacity: 0 }` y el segundo retira las props sin quitar el estilo
 * en linea: el elemento se queda invisible PARA SIEMPRE. Paso de verdad, y lo
 * cazo la auditoria de axe.
 *
 * Este acierta en el primer render porque lee la media query de forma
 * sincrona.
 */
export function useSinMovimiento(): boolean {
  return useMediaQuery(CONSULTA_SIN_MOVIMIENTO);
}
