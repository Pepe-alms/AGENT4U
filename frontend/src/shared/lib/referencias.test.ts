import { describe, expect, it } from 'vitest';

import { copiarConReferencias } from '@/shared/lib/referencias';
import { claveValoracion } from '@/shared/lib/valoraciones';
import type { Fuente } from '@/shared/api/types';

const completa: Fuente = {
  nombre: 'ddia-cap5.pdf',
  origen: '/docs/ddia-cap5.pdf',
  headings: ['Replicación', 'Teorema CAP'],
  paginas: [163, 164],
};
const unaPagina: Fuente = {
  nombre: 'apuntes.md',
  origen: '/d/apuntes.md',
  headings: ['CAP'],
  paginas: [7],
};
const pelada: Fuente = {
  nombre: 'notas.txt',
  origen: 'notas.txt',
  headings: [],
  paginas: [],
};

describe('copiarConReferencias', () => {
  it('sin fuentes copia el texto tal cual, sin cola inútil', () => {
    expect(copiarConReferencias('Hola', [])).toBe('Hola');
  });

  it('numera las fuentes igual que los marcadores del texto', () => {
    const r = copiarConReferencias('Dice [1] y también [2].', [completa, unaPagina]);
    expect(r).toContain('[1] ddia-cap5.pdf');
    expect(r).toContain('[2] apuntes.md');
    expect(r.startsWith('Dice [1] y también [2].')).toBe(true);
  });

  it('incluye secciones y concuerda el plural de las páginas', () => {
    const r = copiarConReferencias('x', [completa, unaPagina]);
    expect(r).toContain('Replicación › Teorema CAP');
    expect(r).toContain('páginas 163, 164');
    expect(r).toContain('página 7');
  });

  it('no repite el origen cuando es igual al nombre', () => {
    const r = copiarConReferencias('Texto.', [pelada]);
    expect(r.split('notas.txt')).toHaveLength(2);
    expect(r.trimEnd().endsWith('—')).toBe(false);
  });
});

describe('claveValoracion', () => {
  // Se ancla al hilo y a la posición, no al id del mensaje: ese cambia de UUID
  // local a numérico del backend al recargar, y la valoración se perdería.
  it('es estable para el mismo hilo y posición', () => {
    expect(claveValoracion(48201, 3)).toBe('48201:3');
    expect(claveValoracion(48201, 3)).toBe(claveValoracion(48201, 3));
  });

  it('distingue hilos y posiciones', () => {
    expect(claveValoracion(48201, 3)).not.toBe(claveValoracion(19377, 3));
    expect(claveValoracion(48201, 3)).not.toBe(claveValoracion(48201, 4));
  });

  it('aguanta que todavía no haya hilo', () => {
    expect(claveValoracion(null, 0)).toBe('sin-hilo:0');
  });
});
