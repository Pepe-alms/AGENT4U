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

/**
 * Cuántas indexaciones se dan por aceptables mientras `GET /ajustes` no
 * conteste.
 *
 * Es el valor por defecto del backend (`index_max_concurrentes` +
 * `index_max_en_cola`), repetido aquí a sabiendas y solo para el hueco entre
 * que la app arranca y el servidor responde. En cuanto `/ajustes` llega, manda
 * el suyo: el servidor puede estar configurado con otro, y entonces este número
 * está mal. Por eso el límite de verdad sigue siendo el 429 del servidor, y
 * esto es nada más que cortesía en la interfaz.
 */
export const MAX_EN_VUELO_PROVISIONAL = 5;

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
  if (estado === 429)
    return 'El servidor está ocupado con otras indexaciones. Inténtalo en unos minutos.';
  if (estado === 413) return 'El fichero es demasiado grande para el servidor.';
  if (estado === 400) return 'El servidor ha rechazado el fichero: puede estar vacío.';
  if (estado === 500) return 'La ingesta falló. Revisa que la ruta exista y sea legible.';
  return porDefecto;
}

/** Trabajos que el servidor tiene ahora mismo: corriendo o esperando turno. */
export function enVuelo(trabajos: Trabajo[]): number {
  return trabajos.filter((t) => t.fase === 'en-cola' || t.fase === 'indexando').length;
}

/**
 * Cuántos trabajos más se pueden mandar sin que el servidor responda 429.
 *
 * Cuenta los que están en vuelo, no los de la lista: los que ya acabaron —bien
 * o mal— no ocupan nada en el servidor, aunque sigan visibles hasta que el
 * usuario los quite.
 */
export function huecosLibres(trabajos: Trabajo[], maxEnVuelo: number): number {
  return Math.max(0, maxEnVuelo - enVuelo(trabajos));
}

/**
 * Parte una selección en lo que cabe y lo que sobra.
 *
 * Se trunca en el cliente en vez de mandarlo todo y dejar que el servidor
 * rechace lo que no quepa. Mandarlo todo tiene dos problemas: el usuario sube
 * diez ficheros y ve cinco errores sin entender por qué justo esos cinco, y
 * cada petición rechazada ha subido ya su cuerpo entero por la red para nada.
 */
export function repartir<T>(items: T[], huecos: number): { caben: T[]; sobran: T[] } {
  return { caben: items.slice(0, huecos), sobran: items.slice(huecos) };
}
