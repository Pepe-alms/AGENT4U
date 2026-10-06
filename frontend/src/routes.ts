import type { FormaCover, PaletaCover } from '@/sitio/tipos';

/**
 * EL MAPA DE RUTAS. Fuente de verdad del sitio.
 *
 * De aqui salen, sin excepcion: la barra de navegacion, el pie, las migas de
 * pan, el bloque "Anterior / Siguiente", el titulo del documento, la meta
 * description y el buscador de la 404. Tambien lo leen las pruebas de punta a
 * punta, que recorren esta lista en vez de llevar las rutas escritas a mano.
 *
 * Si una ruta no esta aqui, no existe. Si esta aqui, aparece en todo lo
 * anterior sin tocar un solo componente. Es lo contrario de tener una lista
 * para la barra, otra para el pie y otra para las pruebas, que es como se
 * acaba con una navegacion que no coincide con el sitio.
 *
 * NO IMPORTA REACT a proposito: las pruebas lo importan directamente y no
 * deben arrastrar JSX ni el arbol de componentes.
 */

export const PRODUCTO = 'Agent4U';
export const LEYENDA_PIE = 'RAG agéntico sobre documentos propios';

/** Donde vive la aplicacion. Fuera del sitio: es otro arbol. */
export const RUTA_APP = '/app';

export type Ruta = {
  /** Identificador estable. No cambia aunque cambie el path. */
  id: string;
  /** Patron de React Router. Los parametros van con dos puntos. */
  path: string;
  /** El texto corto de la barra. */
  label: string;
  /** `<title>` del documento, sin el nombre del producto: se añade solo. */
  title: string;
  /** `<meta name="description">`. Una frase. */
  description: string;
  /** El `id` de la ruta padre, para las migas de pan. */
  parent?: string;
  showInNav: boolean;

  /* --- Lo editorial. Solo lo tienen las paginas con cabecera propia. --- */
  eyebrow?: string;
  titulo?: string;
  entradilla?: string;
  paleta?: PaletaCover;
  forma?: FormaCover;
};

export const RUTAS: Ruta[] = [
  {
    id: 'home',
    path: '/home',
    label: 'Inicio',
    title: 'Inicio',
    description:
      'Pregunta a tus documentos y obtén respuestas con citas, trazadas hasta el fragmento exacto del que salen.',
    showInNav: true,
    eyebrow: 'Empieza aquí',
    titulo: 'Pregunta a tus documentos',
    entradilla: 'Respuestas con citas, trazadas hasta el fragmento exacto del que salen.',
    paleta: 'amanecer',
    forma: 'ondas',
  },
  {
    id: 'arquitectura',
    path: '/arquitectura',
    label: 'Arquitectura',
    title: 'Arquitectura',
    description:
      'Las siete piezas del sistema, con qué está construida cada una y qué se decidió al elegirla.',
    parent: 'home',
    showInNav: true,
    eyebrow: 'Por dentro',
    titulo: 'Siete piezas y una sola dirección de dependencia',
    entradilla:
      'Qué hace cada componente, con qué está construido y qué se decidió al elegirlo.',
    paleta: 'grafito',
    forma: 'capas',
  },
  {
    /*
     * El detalle de un componente es una RUTA y no un estado interno: asi la
     * URL se puede compartir, recargar y encontrar en el historial. Es la
     * diferencia entre "mira el diagrama y pulsa Qdrant" y mandar un enlace.
     */
    id: 'arquitectura-componente',
    path: '/arquitectura/:componente',
    label: 'Componente',
    title: 'Arquitectura',
    description: 'Detalle de un componente del sistema.',
    parent: 'arquitectura',
    showInNav: false,
  },
  {
    id: 'tecnologias',
    path: '/tecnologias',
    label: 'Tecnologías',
    title: 'Tecnologías',
    description:
      'El inventario por capas: qué hay instalado y el trabajo concreto que hace en este proyecto.',
    parent: 'home',
    showInNav: true,
    eyebrow: 'El inventario',
    titulo: 'Qué hay instalado y para qué sirve aquí',
    entradilla:
      'No la descripción del README de cada herramienta: el trabajo concreto que hace en este proyecto.',
    paleta: 'oceano',
    forma: 'rejilla',
  },
  {
    id: 'no-encontrada',
    path: '*',
    label: 'No encontrado',
    title: 'No encontrado',
    description: 'La página que buscabas no existe.',
    showInNav: false,
  },
];

/* --- Consultas sobre el mapa --- */

export function rutaPorId(id: string): Ruta | undefined {
  return RUTAS.find((r) => r.id === id);
}

/** Las que salen en la barra y en el pie, en orden de lectura. */
export const RUTAS_NAV = RUTAS.filter((r) => r.showInNav);

/**
 * El orden de lectura del sitio, para "Anterior / Siguiente". Es el mismo de
 * la barra: si la barra dice que Arquitectura va antes que Tecnologias, el
 * encadenado no puede decir otra cosa.
 */
export const ORDEN_LECTURA = RUTAS_NAV.map((r) => r.id);

export function vecinas(id: string): { anterior?: Ruta; siguiente?: Ruta } {
  const i = ORDEN_LECTURA.indexOf(id);
  if (i === -1) return {};
  return {
    anterior: rutaPorId(ORDEN_LECTURA[i - 1] ?? ''),
    siguiente: rutaPorId(ORDEN_LECTURA[i + 1] ?? ''),
  };
}

/**
 * La cadena de migas, de la raiz a la ruta dada, ambas incluidas.
 *
 * Se recorre `parent` con un tope de profundidad: un `parent` mal puesto que
 * apunte a un ancestro haria un bucle infinito, y eso cuelga la pagina entera
 * en vez de enseñar una miga rara.
 */
export function migasDe(id: string): Ruta[] {
  const cadena: Ruta[] = [];
  let actual = rutaPorId(id);
  let vueltas = 0;

  while (actual && vueltas < 10) {
    cadena.unshift(actual);
    actual = actual.parent ? rutaPorId(actual.parent) : undefined;
    vueltas += 1;
  }

  return cadena;
}

/** El `<title>` completo. Un solo sitio que decida el formato. */
export function tituloDocumento(titulo: string): string {
  return `${titulo} · ${PRODUCTO}`;
}

/** Las rutas sin parametros, que son las que una prueba puede visitar tal cual. */
export const RUTAS_VISITABLES = RUTAS.filter(
  (r) => !r.path.includes(':') && r.path !== '*',
).map((r) => r.path);
