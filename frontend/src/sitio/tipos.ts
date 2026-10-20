/**
 * Tipos compartidos del sitio.
 *
 * Viven en un `.ts` sin React a proposito: `routes.ts` los necesita, y
 * `routes.ts` lo importan tambien las pruebas de punta a punta. Si estos
 * tipos estuvieran en `Cover.tsx`, importar el mapa de rutas desde una prueba
 * arrastraria un modulo con JSX.
 */

export type PaletaCover = 'amanecer' | 'lavanda' | 'oceano' | 'menta' | 'grafito';
export type FormaCover = 'nodos' | 'capas' | 'rejilla' | 'ondas' | 'ninguna';
