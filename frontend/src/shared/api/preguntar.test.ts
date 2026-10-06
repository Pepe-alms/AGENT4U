import { describe, expect, it } from 'vitest';

import { parsearEventoSSE } from '@/shared/api/preguntar';

describe('parsearEventoSSE', () => {
  it('entiende los cinco tipos de evento del backend', () => {
    expect(parsearEventoSSE('data: {"tipo":"inicio","conversacion_id":12345}')).toEqual({
      tipo: 'inicio',
      conversacion_id: 12345,
    });
    expect(parsearEventoSSE('data: {"tipo":"texto","texto":"El teorema "}')).toEqual({
      tipo: 'texto',
      texto: 'El teorema ',
    });
    expect(parsearEventoSSE('data: {"tipo":"fin"}')).toEqual({ tipo: 'fin' });
  });

  it('acepta data: sin espacio', () => {
    expect(parsearEventoSSE('data:{"tipo":"fin"}')).toEqual({ tipo: 'fin' });
  });

  it('ignora los comentarios de keepalive que van delante', () => {
    expect(parsearEventoSSE(': keepalive\ndata: {"tipo":"fin"}')).toEqual({
      tipo: 'fin',
    });
  });

  // Lo importante: un bloque corrupto no debe tumbar el stream entero.
  it('devuelve null ante un JSON cortado en vez de lanzar', () => {
    expect(parsearEventoSSE('data: {"tipo":"tex')).toBeNull();
  });

  it('descarta un tipo que no conoce', () => {
    expect(parsearEventoSSE('data: {"tipo":"ovni"}')).toBeNull();
  });

  /*
   * Esta prueba existe por un fallo real: al añadir `paso` en el backend se
   * olvidó la lista blanca del parser y los pasos del agente se descartaban en
   * silencio. No había error en consola ni en red; simplemente no se veía
   * nada. Cualquier evento nuevo del backend necesita su línea aquí.
   */
  it('reconoce los pasos del agente con sus cifras', () => {
    const evento = parsearEventoSSE(
      'data: {"tipo":"paso","nodo":"buscar","ms":806,"fragmentos":10}',
    );
    expect(evento).toEqual({ tipo: 'paso', nodo: 'buscar', ms: 806, fragmentos: 10 });
  });

  it('devuelve null con bloques que no son eventos', () => {
    expect(parsearEventoSSE('')).toBeNull();
    expect(parsearEventoSSE('event: mensaje')).toBeNull();
    expect(parsearEventoSSE('data: ')).toBeNull();
  });
});
