import type { Fuente } from '@/shared/api/types';

/**
 * Prepara la respuesta para pegarla en otro sitio, con sus fuentes detras.
 *
 * El texto se copia **tal cual**, en markdown: es lo que escribio el modelo y
 * lo que entiende cualquier editor. Las fuentes van en una lista numerada que
 * coincide con los marcadores [n] del texto, para que las citas sigan
 * significando algo fuera de la aplicacion.
 */
export function copiarConReferencias(texto: string, fuentes: Fuente[]): string {
  if (fuentes.length === 0) return texto;

  const lineas = fuentes.map((fuente, indice) => {
    const partes = [fuente.nombre];

    if (fuente.headings.length > 0) partes.push(fuente.headings.join(' › '));
    if (fuente.paginas.length > 0) {
      partes.push(
        `${fuente.paginas.length === 1 ? 'página' : 'páginas'} ${fuente.paginas.join(', ')}`,
      );
    }
    // El origen solo si aporta algo distinto del nombre: en muchos documentos
    // es la misma cadena y repetirla es ruido.
    if (fuente.origen && fuente.origen !== fuente.nombre) partes.push(fuente.origen);

    return `[${indice + 1}] ${partes.join(' — ')}`;
  });

  return `${texto}\n\nFuentes:\n${lineas.join('\n')}`;
}
