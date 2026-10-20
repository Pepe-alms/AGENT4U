import { describe, expect, it } from 'vitest';

import {
  enVuelo,
  huecosLibres,
  mensajeDeIngesta,
  reducirIngesta,
  repartir,
  type AccionIngesta,
  type Trabajo,
} from '@/features/documentos/ingesta';
import { tipoDeRuta } from '@/shared/api/documentos';

const aplicar = (acciones: AccionIngesta[], desde: Trabajo[] = []) =>
  acciones.reduce(reducirIngesta, desde);

describe('reducirIngesta', () => {
  // El roadmap pide progreso y error POR FICHERO: dos trabajos a la vez pueden
  // acabar distinto, y un booleano global no serviría.
  it('lleva el desenlace de cada trabajo por separado', () => {
    const t = aplicar([
      { tipo: 'encolar', id: 'a', origen: '/docs/uno.pdf', clase: 'fichero' },
      { tipo: 'encolar', id: 'b', origen: 'https://x.test/dos', clase: 'url' },
      { tipo: 'empezar', id: 'a' },
      { tipo: 'hecho', id: 'a', fragmentos: 42 },
      { tipo: 'fallo', id: 'b', mensaje: 'Ya estaba indexado.' },
    ]);

    expect(t[0]).toMatchObject({ fase: 'hecho', fragmentos: 42, mensaje: undefined });
    expect(t[1]).toMatchObject({ fase: 'error', mensaje: 'Ya estaba indexado.' });
  });

  it('limpia el error anterior al reintentar', () => {
    const t = aplicar([
      { tipo: 'encolar', id: 'a', origen: 'x', clase: 'url' },
      { tipo: 'fallo', id: 'a', mensaje: 'falló' },
      { tipo: 'hecho', id: 'a', fragmentos: 7 },
    ]);

    expect(t[0]).toMatchObject({ fase: 'hecho', mensaje: undefined });
  });

  it('olvida solo el trabajo indicado', () => {
    const t = aplicar([
      { tipo: 'encolar', id: 'a', origen: 'x', clase: 'url' },
      { tipo: 'encolar', id: 'b', origen: 'y', clase: 'url' },
      { tipo: 'olvidar', id: 'a' },
    ]);

    expect(t.map((x) => x.id)).toEqual(['b']);
  });

  it('no revienta con una acción sobre un id que no existe', () => {
    expect(aplicar([{ tipo: 'hecho', id: 'fantasma', fragmentos: 1 }])).toHaveLength(0);
  });
});

describe('mensajeDeIngesta', () => {
  it('explica el 409, que es el caso frecuente', () => {
    expect(mensajeDeIngesta(409, 'x')).toMatch(/ya estaba indexado/i);
  });

  it('apunta a la ruta en el 500 y al tamaño en el 413', () => {
    expect(mensajeDeIngesta(500, 'x')).toMatch(/ruta/i);
    expect(mensajeDeIngesta(413, 'x')).toMatch(/grande/i);
  });

  it('usa el mensaje de la API cuando no hay código conocido', () => {
    expect(mensajeDeIngesta(undefined, 'sin conexión')).toBe('sin conexión');
  });
});

describe('tipoDeRuta', () => {
  it('saca el tipo de la extensión, en minúsculas', () => {
    expect(tipoDeRuta('/docs/manual.pdf')).toBe('pdf');
    expect(tipoDeRuta('/a.b/c.d.DOCX')).toBe('docx');
  });

  it('cae a txt si no hay extensión', () => {
    expect(tipoDeRuta('/docs/LEEME')).toBe('txt');
  });
});

describe('el cupo de indexaciones en vuelo', () => {
  const trabajo = (fase: Trabajo['fase'], id: string): Trabajo => ({
    id,
    origen: `/docs/${id}.pdf`,
    clase: 'subida',
    fase,
  });

  it('solo cuentan las que el servidor tiene ahora: corriendo o en cola', () => {
    const trabajos = [
      trabajo('indexando', 'a'),
      trabajo('en-cola', 'b'),
      trabajo('hecho', 'c'),
      trabajo('error', 'd'),
    ];

    // 'hecho' y 'error' siguen en la lista hasta que el usuario las quita, pero
    // en el servidor ya no ocupan nada.
    expect(enVuelo(trabajos)).toBe(2);
    expect(huecosLibres(trabajos, 5)).toBe(3);
  });

  it('sin nada en marcha, caben todas', () => {
    expect(huecosLibres([], 5)).toBe(5);
  });

  it('nunca devuelve huecos negativos', () => {
    const siete = Array.from({ length: 7 }, (_, i) => trabajo('indexando', `t${i}`));
    expect(huecosLibres(siete, 5)).toBe(0);
  });

  it('reparte la selección en lo que cabe y lo que sobra', () => {
    const { caben, sobran } = repartir(['a', 'b', 'c', 'd', 'e', 'f'], 5);
    expect(caben).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(sobran).toEqual(['f']);
  });

  it('con cero huecos no manda nada y lo devuelve todo', () => {
    const { caben, sobran } = repartir(['a', 'b'], 0);
    expect(caben).toEqual([]);
    expect(sobran).toEqual(['a', 'b']);
  });

  it('un 429 se explica, no cae al mensaje genérico', () => {
    // Existe porque el 429 no estaba traducido: el usuario veía el texto por
    // defecto, que no dice nada de esperar.
    expect(mensajeDeIngesta(429, 'generico')).toContain('ocupado');
    expect(mensajeDeIngesta(429, 'generico')).not.toBe('generico');
  });
});
