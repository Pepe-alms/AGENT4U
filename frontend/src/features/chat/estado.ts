import type { EventoPaso, Fuente, Mensaje } from '@/shared/api/types';

export type RolChat = 'usuario' | 'agente';

export type MensajeChat = {
  id: string;
  rol: RolChat;
  contenido: string;
  fuentes: Fuente[] | null;
  /** 'escribiendo' mientras llega el stream; los demas son terminales. */
  fase: 'escribiendo' | 'completo' | 'error' | 'detenido';
  /** Por que se cortó. Se guarda aparte del contenido para poder enseñar las
   *  dos cosas: el texto que llegó a escribirse y la causa del corte. */
  motivoError?: string;
  /**
   * Los nodos del grafo que ya han terminado, en orden. Solo lo tienen las
   * respuestas de esta sesión: el backend no los guarda, así que al recargar
   * un hilo vuelve vacío. Es correcto, no un fallo: son el registro de una
   * ejecución, no parte de la respuesta.
   */
  pasos?: EventoPaso[];
};

export type EstadoChat = {
  mensajes: MensajeChat[];
  /** Llega en el evento `inicio`; es la unica forma de conocer el hilo nuevo. */
  conversacionId: number | null;
  enviando: boolean;
  /** Fallo de transporte. Los del modelo viajan en el mensaje, no aqui. */
  error: string | null;
  /** Se guarda para poder reintentar sin que el usuario reescriba. */
  ultimaPregunta: string | null;
};

export type AccionChat =
  | { tipo: 'enviar'; pregunta: string; idUsuario: string; idAgente: string }
  | { tipo: 'inicio'; conversacionId: number }
  | { tipo: 'paso'; paso: EventoPaso }
  | { tipo: 'fuentes'; fuentes: Fuente[] }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'fin' }
  | { tipo: 'errorModelo'; mensaje: string }
  | { tipo: 'errorTransporte'; mensaje: string }
  | { tipo: 'detener' }
  /** Sustituye el hilo entero por uno traido del backend. */
  | { tipo: 'cargar'; conversacionId: number; mensajes: MensajeChat[] }
  | { tipo: 'limpiar' };

export const ESTADO_INICIAL: EstadoChat = {
  mensajes: [],
  conversacionId: null,
  enviando: false,
  error: null,
  ultimaPregunta: null,
};

/** Aplica `cambio` al ultimo mensaje del agente. El resto queda intacto. */
function conUltimoAgente(
  estado: EstadoChat,
  cambio: (mensaje: MensajeChat) => MensajeChat,
): EstadoChat {
  const indice = estado.mensajes.findLastIndex((m) => m.rol === 'agente');
  if (indice === -1) return estado;

  const mensajes = estado.mensajes.slice();
  mensajes[indice] = cambio(mensajes[indice]!);
  return { ...estado, mensajes };
}

/**
 * Reducer puro: ninguna llamada a red, ningun temporizador, ningun acceso al
 * DOM. Toda la logica del chat vive aqui para poder probarla sin React, que es
 * donde esta el riesgo real: el orden de los eventos del stream.
 */
export function reducirChat(estado: EstadoChat, accion: AccionChat): EstadoChat {
  switch (accion.tipo) {
    case 'enviar':
      return {
        ...estado,
        enviando: true,
        error: null,
        ultimaPregunta: accion.pregunta,
        mensajes: [
          ...estado.mensajes,
          {
            id: accion.idUsuario,
            rol: 'usuario',
            contenido: accion.pregunta,
            fuentes: null,
            fase: 'completo',
          },
          {
            id: accion.idAgente,
            rol: 'agente',
            contenido: '',
            fuentes: null,
            fase: 'escribiendo',
          },
        ],
      };

    case 'inicio':
      return { ...estado, conversacionId: accion.conversacionId };

    // Se acumulan en orden de llegada. `buscar` puede repetirse (el grafo
    // abre una rama por subconsulta) y `multiconsulta` tambien, si evaluar
    // decide reescribir: son ejecuciones distintas y se enseñan todas.
    case 'paso':
      return conUltimoAgente(estado, (m) => ({
        ...m,
        pasos: [...(m.pasos ?? []), accion.paso],
      }));

    case 'fuentes':
      return conUltimoAgente(estado, (m) => ({ ...m, fuentes: accion.fuentes }));

    // Los eventos `texto` son incrementales: se concatenan, no se sustituyen.
    case 'texto':
      return conUltimoAgente(estado, (m) => ({
        ...m,
        contenido: m.contenido + accion.texto,
      }));

    case 'fin':
      return {
        ...conUltimoAgente(estado, (m) => ({ ...m, fase: 'completo' })),
        enviando: false,
      };

    // El modelo fallo a mitad. El texto parcial se conserva, porque suele
    // tener valor, y el motivo va en su propio campo: machacar el contenido
    // con el error perderia la respuesta, y no guardarlo dejaria al usuario
    // con una respuesta cortada sin saber por que.
    case 'errorModelo':
      return {
        ...conUltimoAgente(estado, (m) => ({
          ...m,
          fase: 'error',
          motivoError: accion.mensaje,
        })),
        enviando: false,
      };

    case 'errorTransporte':
      return {
        ...conUltimoAgente(estado, (m) => ({ ...m, fase: 'error' })),
        enviando: false,
        error: accion.mensaje,
      };

    case 'detener':
      return {
        ...conUltimoAgente(estado, (m) => ({
          ...m,
          fase: m.contenido ? 'detenido' : 'error',
          motivoError: m.contenido ? undefined : 'Respuesta detenida antes de empezar.',
        })),
        enviando: false,
      };

    // Abrir otro hilo tira lo que hubiera: los mensajes que llegan ya son el
    // estado bueno, y conservar restos del anterior mezclaria dos
    // conversaciones distintas.
    case 'cargar':
      return {
        ...ESTADO_INICIAL,
        conversacionId: accion.conversacionId,
        mensajes: accion.mensajes,
      };

    case 'limpiar':
      return ESTADO_INICIAL;
  }
}

/** Las fuentes del ultimo mensaje del agente que tenga alguna. */
export function fuentesVigentes(estado: EstadoChat): Fuente[] {
  const conFuentes = estado.mensajes.findLast(
    (m) => m.rol === 'agente' && m.fuentes?.length,
  );
  return conFuentes?.fuentes ?? [];
}

/** Pasa los mensajes guardados del backend al formato del chat. */
export function desdeBackend(mensajes: Mensaje[]): MensajeChat[] {
  return mensajes.map((mensaje) => ({
    id: String(mensaje.id),
    rol: mensaje.rol === 'user' ? 'usuario' : 'agente',
    contenido: mensaje.contenido,
    fuentes: mensaje.fuentes,
    fase: 'completo',
  }));
}
