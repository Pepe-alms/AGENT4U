import { describe, expect, it } from 'vitest';

import { ACCIONES, porcentaje, textoParecido } from '@/features/documentos/deduplicacion';

describe('textoParecido', () => {
  it('dice los dos sentidos, redondeados', () => {
    expect(textoParecido('v1.pdf', 0.756, 0.9)).toBe(
      'Se parece a «v1.pdf»: el 76 % de este ya está en aquel, y el 90 % de aquel está en este.',
    );
  });

  it('sin porcentaje, 0 %', () => {
    expect(porcentaje(null)).toBe('0 %');
  });
});

describe('ACCIONES', () => {
  it('ofrece las tres decisiones, y ninguna más', () => {
    expect(ACCIONES.map((a) => a.accion)).toEqual([
      'reemplazar',
      'conservar',
      'descartar',
    ]);
  });
});
