import { describe, expect, it } from 'vitest';

import {
  agruparComandos,
  filtrarComandos,
  type Comando,
} from '@/features/comandos/comandos';

const c = (
  id: string,
  titulo: string,
  grupo: Comando['grupo'],
  detalle?: string,
  alias?: string[],
): Comando => ({ id, titulo, grupo, detalle, alias, ejecutar: () => {} });

const lista: Comando[] = [
  c('nueva', 'Nueva conversación', 'Acciones', 'Vacía el chat', ['empezar']),
  c('docs', 'Ir a documentos', 'Ir a', 'Indexar o borrar', ['pdf', 'subir']),
  c('tema', 'Tema: oscuro', 'Apariencia'),
  c('h1', '¿Qué dice el teorema CAP?', 'Conversaciones', '2 de octubre'),
  c('h2', 'Índices invertidos', 'Conversaciones', '1 de octubre'),
];

const ids = (texto: string) => filtrarComandos(lista, texto).map((x) => x.id);

describe('filtrarComandos', () => {
  it('sin texto devuelve todo', () => {
    expect(filtrarComandos(lista, '')).toHaveLength(5);
    expect(filtrarComandos(lista, '   ')).toHaveLength(5);
  });

  // Nadie escribe los acentos al buscar deprisa.
  it('encuentra lo acentuado escribiendo sin acentos', () => {
    expect(ids('conversacion')).toEqual(['nueva']);
    expect(ids('indices')).toEqual(['h2']);
    expect(ids('que dice')).toEqual(['h1']);
  });

  it('ignora mayúsculas', () => {
    expect(ids('NUEVA')).toEqual(['nueva']);
  });

  it('acepta varias palabras en cualquier orden', () => {
    expect(ids('nueva conv')).toEqual(['nueva']);
    expect(ids('conv nueva')).toEqual(['nueva']);
  });

  it('busca también en el detalle y en los alias', () => {
    expect(ids('vacía')).toEqual(['nueva']);
    expect(ids('pdf')).toEqual(['docs']);
    expect(ids('subir documentos')).toEqual(['docs']);
  });

  it('devuelve lista vacía si nada coincide', () => {
    expect(filtrarComandos(lista, 'xyzzy')).toHaveLength(0);
  });
});

describe('agruparComandos', () => {
  it('agrupa conservando el orden y sin grupos vacíos', () => {
    const grupos = agruparComandos(lista);
    expect(grupos.map((g) => g.grupo)).toEqual([
      'Acciones',
      'Ir a',
      'Apariencia',
      'Conversaciones',
    ]);
    expect(grupos[3]!.comandos).toHaveLength(2);
  });

  it('no pierde ninguno', () => {
    const total = agruparComandos(lista).reduce((n, g) => n + g.comandos.length, 0);
    expect(total).toBe(lista.length);
  });
});
