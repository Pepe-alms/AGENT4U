import { describe, expect, it } from 'vitest';

import {
  agruparPorFecha,
  fechaCorta,
  formatearFecha,
  grupoDeFecha,
} from '@/shared/lib/fechas';

const AHORA = new Date('2026-10-04T10:00:00');

describe('grupoDeFecha', () => {
  it('pone en Hoy lo del mismo día', () => {
    expect(grupoDeFecha('2026-10-04T09:00:00', AHORA)).toBe('Hoy');
    expect(grupoDeFecha('2026-10-04T00:05:00', AHORA)).toBe('Hoy');
  });

  // La frontera que más se falla: compara días de calendario, no horas.
  it('cuenta anoche a las 23:50 como Ayer, aunque hayan pasado 10 horas', () => {
    expect(grupoDeFecha('2026-10-03T23:50:00', AHORA)).toBe('Ayer');
  });

  it('corta los últimos 7 días en el día 7', () => {
    expect(grupoDeFecha('2026-09-28T12:00:00', AHORA)).toBe('Últimos 7 días');
    expect(grupoDeFecha('2026-09-27T12:00:00', AHORA)).toBe('Anteriores');
  });

  it('manda a Anteriores todo lo que pase de una semana', () => {
    expect(grupoDeFecha('2026-09-05T12:00:00', AHORA)).toBe('Anteriores');
    expect(grupoDeFecha('2025-01-04T12:00:00', AHORA)).toBe('Anteriores');
  });

  // Un reloj desajustado es menos raro de ver bajo "Hoy" que bajo "Anteriores".
  it('trata una fecha futura como de hoy', () => {
    expect(grupoDeFecha('2026-10-05T12:00:00', AHORA)).toBe('Hoy');
  });

  it('no revienta con una fecha inválida', () => {
    expect(grupoDeFecha('no-es-fecha', AHORA)).toBe('Anteriores');
  });
});

describe('agruparPorFecha', () => {
  const convs = [
    { id: 1, f: '2026-10-04T09:00:00' },
    { id: 2, f: '2026-09-04T09:00:00' },
    { id: 3, f: '2026-10-03T23:00:00' },
    { id: 4, f: '2026-10-04T08:00:00' },
  ];

  it('devuelve solo los grupos con contenido, de reciente a antiguo', () => {
    const grupos = agruparPorFecha(convs, (c) => c.f, AHORA);
    expect(grupos.map((g) => g.grupo)).toEqual(['Hoy', 'Ayer', 'Anteriores']);
  });

  it('conserva el orden de entrada dentro de cada grupo', () => {
    const grupos = agruparPorFecha(convs, (c) => c.f, AHORA);
    expect(grupos[0]!.elementos.map((e) => e.id)).toEqual([1, 4]);
  });

  it('no pierde ningún elemento', () => {
    const total = agruparPorFecha(convs, (c) => c.f, AHORA).reduce(
      (n, g) => n + g.elementos.length,
      0,
    );
    expect(total).toBe(convs.length);
  });

  it('con una lista vacía devuelve una lista vacía', () => {
    expect(agruparPorFecha([], () => '', AHORA)).toEqual([]);
  });
});

describe('formatearFecha', () => {
  it('devuelve la cadena tal cual si no es una fecha', () => {
    expect(formatearFecha('vaya')).toBe('vaya');
  });
});

describe('fechaCorta', () => {
  // Lo que se gana: la fila de la lista pasa de dos líneas a una.
  it('de hoy enseña solo la hora', () => {
    expect(fechaCorta('2026-10-04T09:05:00', AHORA)).toBe('9:05');
  });

  it('de ayer enseña la palabra, no la fecha', () => {
    expect(fechaCorta('2026-10-03T23:50:00', AHORA)).toBe('ayer');
  });

  it('de este año enseña día y mes, sin año', () => {
    expect(fechaCorta('2026-09-05T12:00:00', AHORA)).toMatch(/^5 sept/);
  });

  // El año solo aparece cuando de verdad distingue algo.
  it('de otro año añade el año', () => {
    expect(fechaCorta('2025-09-05T12:00:00', AHORA)).toContain('2025');
  });

  it('con una fecha inválida devuelve cadena vacía, no "Invalid Date"', () => {
    expect(fechaCorta('no-es-fecha', AHORA)).toBe('');
  });
});
