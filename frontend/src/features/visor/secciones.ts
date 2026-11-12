/**
 * El Markdown de un documento, partido en secciones.
 *
 * Un documento de cientos de paginas no se puede convertir y pintar de una vez
 * sin congelar la pantalla. Partido por titulos, cada seccion se convierte
 * cuando esta a punto de verse (ver `VisorDocumento`), y el indice y el salto
 * desde una fuente trabajan sobre esta lista, sin tocar el DOM.
 *
 * Funciones puras: ni React ni DOM, para poder probarlas solas.
 */

export type Seccion = {
  /** Posicion en la lista. Sirve de id estable dentro de un documento. */
  indice: number;
  /** El texto del titulo, ya sin `#`. Vacio en el preambulo sin titulo. */
  titulo: string;
  /** 1 a 6, o 0 para el preambulo. */
  nivel: number;
  /** Pagina en la que empieza. null si el documento no trae marcas. */
  pagina: number | null;
  /** El Markdown de la seccion, titulo incluido y sin marcas de pagina. */
  markdown: string;
};

const MARCA_PAGINA = /^<!-- pagina (\d+) -->$/;
const TITULO = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const VALLA = /^(```|~~~)/;

/**
 * Parte el Markdown por titulos y le pone a cada seccion la pagina en la que
 * empieza, segun las marcas `<!-- pagina N -->` que guarda el backend.
 *
 * Los `#` dentro de un bloque de codigo no son titulos: se sigue la valla de
 * apertura y cierre.
 */
export function trocearEnSecciones(markdown: string): Seccion[] {
  const secciones: Seccion[] = [];
  let pagina: number | null = null;
  let actual: { titulo: string; nivel: number; pagina: number | null; lineas: string[] } =
    {
      titulo: '',
      nivel: 0,
      pagina: null,
      lineas: [],
    };
  let enCodigo = false;

  const cerrar = () => {
    const texto = actual.lineas.join('\n').trim();
    // Un preambulo vacio (lo normal: el documento empieza por su titulo) no
    // es una seccion.
    if (actual.nivel === 0 && !texto) return;
    secciones.push({
      indice: secciones.length,
      titulo: actual.titulo,
      nivel: actual.nivel,
      pagina: actual.pagina,
      markdown: texto,
    });
  };

  for (const linea of markdown.split('\n')) {
    const recortada = linea.trim();

    if (!enCodigo) {
      const marca = MARCA_PAGINA.exec(recortada);
      if (marca) {
        pagina = Number(marca[1]);
        // Una seccion que aun no tiene texto empieza, de hecho, aqui.
        if (!actual.lineas.some((l) => l.trim())) actual.pagina = pagina;
        continue;
      }

      const titulo = TITULO.exec(recortada);
      if (titulo) {
        cerrar();
        actual = {
          titulo: titulo[2]!,
          nivel: titulo[1]!.length,
          pagina,
          lineas: [linea],
        };
        continue;
      }
    }

    if (VALLA.test(recortada)) enCodigo = !enCodigo;
    actual.lineas.push(linea);
  }

  cerrar();
  return secciones;
}

/**
 * El titulo tal como lo compara el salto desde una fuente.
 *
 * El Markdown de Docling escapa el HTML (`&amp;`) y los guiones bajos (`\_`),
 * y la fuente trae el texto limpio; sin esto, "I+D & innovación" no
 * coincidiria nunca con su propio titulo.
 */
export function normalizarTitulo(texto: string): string {
  return tituloLegible(texto).normalize('NFC').toLocaleLowerCase('es');
}

/** El titulo para enseñarlo como texto plano: sin escapes, con su caja. */
export function tituloLegible(texto: string): string {
  return texto
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La seccion en la que situarse al abrir el documento desde una fuente.
 *
 * Primero por titulo (el ultimo de los `headings` de la fuente, que es el mas
 * cercano al fragmento). Los documentos repiten titulos ("Disposiciones
 * generales" en cada capitulo), asi que si hay varios se elige su ultima
 * aparicion en la pagina de la fuente o antes. Si ningun titulo coincide, la
 * seccion en la que cae esa pagina. null si no hay nada fiable a lo que ir.
 */
export function buscarSeccion(
  secciones: Seccion[],
  destino: { seccion?: string | null; pagina?: number | null },
): number | null {
  const pagina = destino.pagina ?? null;
  if (destino.seccion) {
    const buscado = normalizarTitulo(destino.seccion);
    const candidatas = secciones.filter(
      (s) => s.nivel > 0 && normalizarTitulo(s.titulo) === buscado,
    );
    if (candidatas.length === 1) return candidatas[0]!.indice;
    if (candidatas.length > 1) {
      if (pagina === null) return candidatas[0]!.indice;
      // El fragmento esta bajo la ULTIMA aparicion del titulo que empieza en
      // su pagina o antes: un titulo repetido (la cabecera de cada pagina de
      // un BOE) cubre solo hasta la siguiente aparicion.
      const anteriores = candidatas.filter(
        (s) => s.pagina !== null && s.pagina <= pagina,
      );
      if (anteriores.length) return anteriores.at(-1)!.indice;
      // Todas empiezan despues: la mas cercana.
      return candidatas.reduce((mejor, s) =>
        Math.abs((s.pagina ?? 0) - pagina) < Math.abs((mejor.pagina ?? 0) - pagina)
          ? s
          : mejor,
      ).indice;
    }
  }

  if (pagina === null) return null;
  // La ultima seccion que empieza en esa pagina o antes.
  let encontrada: number | null = null;
  for (const seccion of secciones) {
    if (seccion.pagina !== null && seccion.pagina <= pagina) encontrada = seccion.indice;
  }
  return encontrada;
}
