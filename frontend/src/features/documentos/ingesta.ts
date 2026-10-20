/** Un intento de indexar algo, con su propio desenlace. */
export type Trabajo = {
  id: string;
  /** La ruta en el servidor o la URL, tal cual se envió. */
  origen: string;
  clase: 'fichero' | 'url' | 'subida';
  fase: 'en-cola' | 'indexando' | 'hecho' | 'error';
  /** Fragmentos generados. Solo cuando la fase es 'hecho'. */
  fragmentos?: number;
  mensaje?: string;
};

export type AccionIngesta =
  | { tipo: 'encolar'; id: string; origen: string; clase: Trabajo['clase'] }
  | { tipo: 'empezar'; id: string }
  | { tipo: 'hecho'; id: string; fragmentos: number }
  | { tipo: 'fallo'; id: string; mensaje: string }
  | { tipo: 'olvidar'; id: string };

function cambiar(trabajos: Trabajo[], id: string, cambio: Partial<Trabajo>): Trabajo[] {
  return trabajos.map((t) => (t.id === id ? { ...t, ...cambio } : t));
}

/**
 * Reducer puro: cada trabajo lleva su propio estado, que es lo que pide el
 * roadmap ("progreso, éxito y error **por fichero**"). Un único estado global
 * de "indexando" no serviría: dos ficheros pueden acabar distinto.
 */
export function reducirIngesta(trabajos: Trabajo[], accion: AccionIngesta): Trabajo[] {
  switch (accion.tipo) {
    case 'encolar':
      return [
        ...trabajos,
        { id: accion.id, origen: accion.origen, clase: accion.clase, fase: 'en-cola' },
      ];
    case 'empezar':
      return cambiar(trabajos, accion.id, { fase: 'indexando' });
    case 'hecho':
      return cambiar(trabajos, accion.id, {
        fase: 'hecho',
        fragmentos: accion.fragmentos,
        mensaje: undefined,
      });
    case 'fallo':
      return cambiar(trabajos, accion.id, { fase: 'error', mensaje: accion.mensaje });
    case 'olvidar':
      return trabajos.filter((t) => t.id !== accion.id);
  }
}

/**
 * Traduce el fallo al lenguaje del usuario. El 409 es el caso frecuente y su
 * `detail` del backend no explica qué hacer: si ya está indexado, no hay nada
 * que arreglar.
 */
export function mensajeDeIngesta(estado: number | undefined, porDefecto: string): string {
  if (estado === 409) return 'Ya estaba indexado. No hace falta volver a hacerlo.';
  if (estado === 413) return 'El fichero es demasiado grande para el servidor.';
  if (estado === 400) return 'El servidor ha rechazado el fichero: puede estar vacío.';
  if (estado === 500) return 'La ingesta falló. Revisa que la ruta exista y sea legible.';
  return porDefecto;
}
