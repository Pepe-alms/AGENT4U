import { describe, expect, it } from 'vitest';

import {
  buscarSeccion,
  normalizarTitulo,
  trocearEnSecciones,
} from '@/features/visor/secciones';

const DOCUMENTO = [
  '<!-- pagina 1 -->',
  '',
  '# Ley de prueba',
  '',
  'Preámbulo de la ley.',
  '',
  '## Disposiciones generales',
  '',
  'Primer capítulo.',
  '',
  '<!-- pagina 2 -->',
  '',
  'Sigue en la página dos.',
  '',
  '## Teorema CAP',
  '',
  '```python',
  '# esto es código, no un título',
  '```',
  '',
  '<!-- pagina 3 -->',
  '',
  '## Disposiciones generales',
  '',
  'Segundo capítulo, mismo título.',
  '',
  '<!-- pagina 4 -->',
  '',
  '### I+D &amp; innovación\\_2026',
  '',
  'Texto.',
].join('\n');

describe('trocearEnSecciones', () => {
  const secciones = trocearEnSecciones(DOCUMENTO);

  it('parte por títulos y no confunde un # dentro de código', () => {
    expect(secciones.map((s) => [s.nivel, s.titulo])).toEqual([
      [1, 'Ley de prueba'],
      [2, 'Disposiciones generales'],
      [2, 'Teorema CAP'],
      [2, 'Disposiciones generales'],
      [3, 'I+D &amp; innovación\\_2026'],
    ]);
    expect(secciones[2]!.markdown).toContain('# esto es código');
  });

  it('pone a cada sección la página en la que empieza', () => {
    expect(secciones.map((s) => s.pagina)).toEqual([1, 1, 2, 3, 4]);
  });

  it('quita las marcas de página del texto que se pinta', () => {
    expect(secciones.every((s) => !s.markdown.includes('<!-- pagina'))).toBe(true);
    // Pero no el texto que había después de una marca a mitad de sección.
    expect(secciones[1]!.markdown).toContain('Sigue en la página dos.');
  });

  it('sin marcas de página, la página es null', () => {
    const sinMarcas = trocearEnSecciones('# Uno\n\nTexto\n\n## Dos\n\nMás');
    expect(sinMarcas.map((s) => s.pagina)).toEqual([null, null]);
  });

  it('el texto anterior al primer título es un preámbulo de nivel 0', () => {
    const conPreambulo = trocearEnSecciones('Texto suelto.\n\n# Título\n\nCuerpo');
    expect(conPreambulo.map((s) => [s.nivel, s.titulo])).toEqual([
      [0, ''],
      [1, 'Título'],
    ]);
  });
});

describe('buscarSeccion', () => {
  const secciones = trocearEnSecciones(DOCUMENTO);

  it('encuentra la sección por su título', () => {
    expect(buscarSeccion(secciones, { seccion: 'Teorema CAP', pagina: 2 })).toBe(2);
  });

  it('con un título repetido elige el que cubre la página de la fuente', () => {
    expect(
      buscarSeccion(secciones, { seccion: 'Disposiciones generales', pagina: 1 }),
    ).toBe(1);
    expect(
      buscarSeccion(secciones, { seccion: 'Disposiciones generales', pagina: 3 }),
    ).toBe(3);
  });

  it('con una cabecera repetida en cada página, va a la de la página de la fuente', () => {
    // Asi salen los BOE: "BOLETÍN OFICIAL DEL ESTADO" es un titulo en cada
    // pagina, y elegir la primera que "cubre" la pagina caia una antes.
    const boe = trocearEnSecciones(
      [1, 2, 3, 4]
        .map(
          (n) => `<!-- pagina ${n} -->\n\n## BOLETÍN OFICIAL DEL ESTADO\n\nPágina ${n}.`,
        )
        .join('\n\n'),
    );
    expect(buscarSeccion(boe, { seccion: 'BOLETÍN OFICIAL DEL ESTADO', pagina: 3 })).toBe(
      2,
    );
    expect(buscarSeccion(boe, { seccion: 'BOLETÍN OFICIAL DEL ESTADO', pagina: 4 })).toBe(
      3,
    );
  });

  it('compara títulos sin escapes de HTML ni de Markdown, ni mayúsculas', () => {
    expect(
      buscarSeccion(secciones, { seccion: 'i+d & INNOVACIÓN_2026', pagina: 4 }),
    ).toBe(4);
  });

  it('si el título no aparece, va a la sección en la que cae la página', () => {
    expect(buscarSeccion(secciones, { seccion: 'No existe', pagina: 2 })).toBe(2);
    expect(buscarSeccion(secciones, { pagina: 3 })).toBe(3);
  });

  it('sin título reconocible ni página, no se inventa un destino', () => {
    expect(buscarSeccion(secciones, { seccion: 'No existe' })).toBeNull();
    expect(buscarSeccion(secciones, {})).toBeNull();
  });
});

describe('normalizarTitulo', () => {
  it('deshace los escapes que mete Docling', () => {
    expect(normalizarTitulo('Art\\_1 &amp;  &lt;b&gt;')).toBe('art_1 & <b>');
  });
});
