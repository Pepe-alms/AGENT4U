import { describe, expect, it } from 'vitest';

import {
  desdeBackend,
  ESTADO_INICIAL,
  fuentesVigentes,
  reducirChat,
  type AccionChat,
  type EstadoChat,
} from '@/features/chat/estado';
import type { Fuente } from '@/shared/api/types';

const aplicar = (acciones: AccionChat[], desde: EstadoChat = ESTADO_INICIAL) =>
  acciones.reduce(reducirChat, desde);

const enviar: AccionChat = {
  tipo: 'enviar',
  pregunta: '¿Qué es CAP?',
  idUsuario: 'u1',
  idAgente: 'a1',
};

const FUENTE: Fuente = {
  nombre: 'cap.pdf',
  origen: '/d/cap.pdf',
  headings: ['Teorema CAP'],
  paginas: [7],
};

describe('reducirChat', () => {
  it('sigue el orden de eventos que garantiza el backend', () => {
    const e = aplicar([
      enviar,
      { tipo: 'inicio', conversacionId: 12345 },
      { tipo: 'fuentes', fuentes: [FUENTE] },
      { tipo: 'texto', texto: 'El teorema CAP ' },
      { tipo: 'texto', texto: 'dice que...' },
      { tipo: 'fin' },
    ]);

    expect(e.mensajes).toHaveLength(2);
    // Los eventos `texto` son incrementales: se concatenan.
    expect(e.mensajes[1]!.contenido).toBe('El teorema CAP dice que...');
    expect(e.mensajes[1]!.fase).toBe('completo');
    expect(e.conversacionId).toBe(12345);
    expect(e.enviando).toBe(false);
  });

  it('conserva el texto parcial cuando el modelo falla a mitad', () => {
    const e = aplicar([
      enviar,
      { tipo: 'texto', texto: 'Parcial...' },
      { tipo: 'errorModelo', mensaje: 'el LLM falló' },
    ]);

    expect(e.mensajes[1]!.contenido).toBe('Parcial...');
    expect(e.mensajes[1]!.motivoError).toBe('el LLM falló');
    // Un fallo del modelo llega dentro de un 200: no es un error de transporte.
    expect(e.error).toBeNull();
  });

  it('saca el fallo de transporte a nivel de chat y guarda la pregunta', () => {
    const e = aplicar([enviar, { tipo: 'errorTransporte', mensaje: 'sin conexión' }]);
    expect(e.error).toBe('sin conexión');
    expect(e.ultimaPregunta).toBe('¿Qué es CAP?');
  });

  it('marca como detenida la respuesta con texto y explica la que no lo tiene', () => {
    const conTexto = aplicar([
      enviar,
      { tipo: 'texto', texto: 'A medias' },
      { tipo: 'detener' },
    ]);
    expect(conTexto.mensajes[1]!.fase).toBe('detenido');
    expect(conTexto.mensajes[1]!.motivoError).toBeUndefined();

    const sinTexto = aplicar([enviar, { tipo: 'detener' }]);
    expect(sinTexto.mensajes[1]!.fase).toBe('error');
    expect(sinTexto.mensajes[1]!.motivoError).toBeTruthy();
  });

  it('manda el texto al último agente y no pisa el turno anterior', () => {
    const e = aplicar([
      enviar,
      { tipo: 'texto', texto: 'Primera' },
      { tipo: 'fin' },
      { tipo: 'enviar', pregunta: '¿Y BASE?', idUsuario: 'u2', idAgente: 'a2' },
      { tipo: 'texto', texto: 'Segunda' },
      { tipo: 'fin' },
    ]);

    expect(e.mensajes).toHaveLength(4);
    expect(e.mensajes[1]!.contenido).toBe('Primera');
    expect(e.mensajes[3]!.contenido).toBe('Segunda');
  });

  it('aguanta eventos que llegan sin mensaje al que aplicarlos', () => {
    const e = aplicar([
      { tipo: 'texto', texto: 'huérfano' },
      { tipo: 'fuentes', fuentes: [FUENTE] },
    ]);
    expect(e.mensajes).toHaveLength(0);
  });

  it('al cargar un hilo tira lo anterior para no mezclar conversaciones', () => {
    const previo = aplicar([enviar, { tipo: 'texto', texto: 'viejo' }, { tipo: 'fin' }]);
    const e = reducirChat(previo, {
      tipo: 'cargar',
      conversacionId: 999,
      mensajes: desdeBackend([
        { id: 1, rol: 'user', contenido: 'otra', fuentes: null, creado_en: 'x' },
      ]),
    });

    expect(e.conversacionId).toBe(999);
    expect(e.mensajes).toHaveLength(1);
    expect(e.mensajes[0]!.contenido).toBe('otra');
  });
});

describe('desdeBackend', () => {
  it('traduce los roles del backend a los del chat', () => {
    const [usuario, agente] = desdeBackend([
      { id: 1, rol: 'user', contenido: 'hola', fuentes: null, creado_en: 'x' },
      {
        id: 2,
        rol: 'assistant',
        contenido: 'qué tal',
        fuentes: [FUENTE],
        creado_en: 'x',
      },
    ]);

    expect(usuario!.rol).toBe('usuario');
    expect(agente!.rol).toBe('agente');
    // Lo que viene del backend ya está terminado.
    expect(agente!.fase).toBe('completo');
  });
});

describe('fuentesVigentes', () => {
  it('se queda con las del último agente que tenga alguna', () => {
    const e = aplicar([
      enviar,
      { tipo: 'fuentes', fuentes: [FUENTE] },
      { tipo: 'fin' },
      { tipo: 'enviar', pregunta: 'otra', idUsuario: 'u3', idAgente: 'a3' },
      { tipo: 'fin' },
    ]);

    expect(fuentesVigentes(e)).toHaveLength(1);
  });
});
