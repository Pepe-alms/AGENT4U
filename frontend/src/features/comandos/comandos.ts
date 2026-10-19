export type Comando = {
  id: string;
  titulo: string;
  /** Linea de debajo: a donde lleva o que hace. */
  detalle?: string;
  /** Para agrupar en la lista. */
  grupo: 'Acciones' | 'Ir a' | 'Apariencia' | 'Conversaciones';
  /** Palabras que tambien deberian encontrarlo, ademas del titulo. */
  alias?: string[];
  ejecutar: () => void;
};

/** Quita acentos y pasa a minusculas, para que "camara" encuentre "cámara". */
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Filtra por subcadena sobre titulo, detalle y alias.
 *
 * Se eligio subcadena y no coincidencia difusa a proposito: con pocas opciones,
 * lo difuso devuelve resultados que el usuario no entiende por que estan ahi.
 * Cada palabra del texto tiene que aparecer en alguna parte, asi que "nueva
 * conv" encuentra "Nueva conversacion".
 */
export function filtrarComandos(comandos: Comando[], texto: string): Comando[] {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return comandos;

  return comandos.filter((comando) => {
    const heno = normalizar(
      [comando.titulo, comando.detalle ?? '', ...(comando.alias ?? [])].join(' '),
    );
    return palabras.every((palabra) => heno.includes(palabra));
  });
}

/** Reparte en grupos conservando el orden y sin devolver grupos vacios. */
export function agruparComandos(
  comandos: Comando[],
): Array<{ grupo: string; comandos: Comando[] }> {
  const cajones = new Map<string, Comando[]>();

  for (const comando of comandos) {
    const cajon = cajones.get(comando.grupo);
    if (cajon) cajon.push(comando);
    else cajones.set(comando.grupo, [comando]);
  }

  return [...cajones].map(([grupo, lista]) => ({ grupo, comandos: lista }));
}
