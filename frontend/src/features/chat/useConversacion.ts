import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { mensajeDeError } from '@/shared/api/errores';
import { preguntar } from '@/shared/api/preguntar';
import {
  desdeBackend,
  ESTADO_INICIAL,
  fuentesVigentes,
  reducirChat,
  type EstadoChat,
  type MensajeChat,
} from '@/features/chat/estado';
import { obtenerConversacion } from '@/shared/api/conversaciones';
import type { AjustesConsulta } from '@/shared/lib/consulta';
import { guardarHiloActivo, leerHiloActivo } from '@/shared/lib/hiloActivo';
import type { Fuente } from '@/shared/api/types';

export type Conversacion = {
  /** Id del hilo abierto, o null si todavia no existe en el backend. */
  id: number | null;
  mensajes: MensajeChat[];
  /** Mientras se trae un hilo del historial. */
  abriendo: boolean;
  enviando: boolean;
  error: string | null;
  fuentes: Fuente[];
  puedeReintentar: boolean;
  enviar: (pregunta: string) => void;
  detener: () => void;
  reintentar: () => void;
  /** Vuelve a lanzar la pregunta que dio lugar a esa respuesta. */
  regenerar: (idMensaje: string) => void;
  /** Trae un hilo del historial y lo deja abierto. */
  abrir: (id: number) => Promise<void>;
  /** Vacia el chat para empezar uno nuevo. El backend lo creara al preguntar. */
  nueva: () => void;
};

/**
 * `ajustes` entra por parametro y se lee desde una ref dentro del envio: si se
 * metiese en las dependencias de `enviar`, su identidad cambiaria cada vez que
 * el usuario toca el panel y se recrearian los manejadores de toda la pantalla.
 */
export function useConversacion(ajustes: AjustesConsulta): Conversacion {
  const [estado, despachar] = useReducer(reducirChat, ESTADO_INICIAL);
  const [abriendo, setAbriendo] = useState(false);

  // El id del hilo vive tambien en una ref para que `enviar` no dependa del
  // estado y mantenga su identidad entre renders.
  const idConversacion = useRef<number | null>(null);
  const control = useRef<AbortController | null>(null);

  // Se actualiza en un efecto y no durante el render: escribir una ref
  // mientras se renderiza rompe la suposición de React de que el render es
  // puro, y `oxlint` lo marca con razón.
  const ajustesVigentes = useRef(ajustes);
  useEffect(() => {
    ajustesVigentes.current = ajustes;
  }, [ajustes]);

  // Si el componente se va con un stream abierto, se corta: si no, el lector
  // sigue vivo y se despacha sobre algo que ya no existe.
  useEffect(() => () => control.current?.abort(), []);

  // El id del hilo abierto se recuerda para que recargar no lo pierda. Los
  // mensajes no: los tiene el backend. Cubre los cambios de hilo que no vienen
  // de un stream (abrir una conversacion de la lista o de la paleta); el
  // stream lo guarda el mismo, en cuanto lo sabe.
  //
  // Solo se guarda cuando hay hilo. Guardar `null` aquí borraría la memoria en
  // el primer render, antes de que el efecto de restauración llegue a leerla:
  // olvidar es cosa de `nueva()`, que es la acción que de verdad lo pide.
  useEffect(() => {
    if (estado.conversacionId !== null) guardarHiloActivo(estado.conversacionId);
  }, [estado.conversacionId]);

  const enviar = useCallback((pregunta: string) => {
    const limpia = pregunta.trim();
    if (!limpia || control.current) return;

    const nuevoControl = new AbortController();
    control.current = nuevoControl;

    despachar({
      tipo: 'enviar',
      pregunta: limpia,
      idUsuario: crypto.randomUUID(),
      idAgente: crypto.randomUUID(),
    });

    void (async () => {
      let terminado = false;
      try {
        const { maxFragmentos, modelo } = ajustesVigentes.current;
        const stream = preguntar(
          {
            query: limpia,
            conversacion_id: idConversacion.current ?? undefined,
            // Se omiten si el usuario no ha elegido nada, para que mande el
            // valor por defecto del servidor.
            ...(maxFragmentos !== null ? { max_fragmentos: maxFragmentos } : {}),
            ...(modelo !== null ? { modelo } : {}),
          },
          { signal: nuevoControl.signal },
        );

        for await (const evento of stream) {
          switch (evento.tipo) {
            case 'inicio':
              idConversacion.current = evento.conversacion_id;
              // Se guarda aqui mismo, y no solo en el efecto de abajo: el
              // efecto corre DESPUES de pintar, asi que hay un hueco de un
              // fotograma en el que la respuesta ya se ve pero el id aun no
              // esta en local. Quien recargue en ese hueco perderia un hilo
              // que el backend si tiene guardado. Lo cazo la prueba de punta
              // a punta del recargado, que recarga en cuanto puede.
              guardarHiloActivo(evento.conversacion_id);
              despachar({ tipo: 'inicio', conversacionId: evento.conversacion_id });
              break;
            case 'paso':
              despachar({ tipo: 'paso', paso: evento });
              break;
            case 'fuentes':
              despachar({ tipo: 'fuentes', fuentes: evento.fuentes });
              break;
            case 'texto':
              despachar({ tipo: 'texto', texto: evento.texto });
              break;
            case 'error':
              // Un fallo del modelo llega DENTRO de un 200, como evento.
              terminado = true;
              despachar({ tipo: 'errorModelo', mensaje: evento.mensaje });
              break;
            case 'fin':
              terminado = true;
              despachar({ tipo: 'fin' });
              break;
          }
        }

        // El stream puede cerrarse sin evento terminal (proceso caido a mitad).
        // Sin esto, `enviando` se quedaria en true para siempre.
        if (!terminado) despachar({ tipo: 'fin' });
      } catch (error) {
        if (nuevoControl.signal.aborted) despachar({ tipo: 'detener' });
        else despachar({ tipo: 'errorTransporte', mensaje: mensajeDeError(error) });
      } finally {
        control.current = null;
      }
    })();
  }, []);

  const detener = useCallback(() => control.current?.abort(), []);

  /**
   * "Regenerar" vuelve a preguntar lo mismo, y la respuesta nueva se añade al
   * final: **no sustituye a la anterior**.
   *
   * No es una elección de diseño, es lo que permite el backend. Ya ha guardado
   * la primera respuesta en la conversación y no hay endpoint para borrar ni
   * reemplazar un mensaje, así que borrarla solo aquí dejaría la pantalla
   * diciendo una cosa y la base de datos otra. Dejar las dos a la vista es
   * menos cómodo pero es verdad, y además deja comparar.
   */
  const regenerar = useCallback(
    (idMensaje: string) => {
      const indice = estado.mensajes.findIndex((m) => m.id === idMensaje);
      if (indice < 1) return;

      // La pregunta que dio lugar a esa respuesta es el mensaje de usuario
      // inmediatamente anterior.
      for (let i = indice - 1; i >= 0; i--) {
        const mensaje = estado.mensajes[i];
        if (mensaje?.rol === 'usuario') {
          enviar(mensaje.contenido);
          return;
        }
      }
    },
    [estado.mensajes, enviar],
  );

  const abrir = useCallback(async (id: number) => {
    // Si habia una respuesta llegando, se corta: pertenece al hilo que se deja.
    control.current?.abort();
    setAbriendo(true);
    try {
      const detalle = await obtenerConversacion(id);
      idConversacion.current = detalle.id;
      despachar({
        tipo: 'cargar',
        conversacionId: detalle.id,
        mensajes: desdeBackend(detalle.mensajes),
      });
    } catch (error) {
      despachar({ tipo: 'errorTransporte', mensaje: mensajeDeError(error) });
    } finally {
      setAbriendo(false);
    }
  }, []);

  // Al arrancar se reabre el ultimo hilo, si lo habia. Si ya no existe (se
  // borro desde otra pestana) el fallo se traga: empezar en blanco es mejor
  // que recibir un error nada mas abrir la aplicacion.
  const yaRestaurado = useRef(false);
  useEffect(() => {
    if (yaRestaurado.current) return;
    yaRestaurado.current = true;

    const ultimo = leerHiloActivo();
    if (ultimo === null) return;

    void obtenerConversacion(ultimo)
      .then((detalle) => {
        idConversacion.current = detalle.id;
        despachar({
          tipo: 'cargar',
          conversacionId: detalle.id,
          mensajes: desdeBackend(detalle.mensajes),
        });
      })
      .catch(() => guardarHiloActivo(null));
  }, []);

  const nueva = useCallback(() => {
    control.current?.abort();
    idConversacion.current = null;
    guardarHiloActivo(null);
    despachar({ tipo: 'limpiar' });
  }, []);

  const reintentar = useCallback(() => {
    if (estado.ultimaPregunta) enviar(estado.ultimaPregunta);
  }, [estado.ultimaPregunta, enviar]);

  return {
    id: estado.conversacionId,
    abriendo,
    mensajes: estado.mensajes,
    enviando: estado.enviando,
    error: estado.error,
    fuentes: fuentesVigentes(estado as EstadoChat),
    puedeReintentar: Boolean(estado.error && estado.ultimaPregunta && !estado.enviando),
    enviar,
    detener,
    reintentar,
    regenerar,
    abrir,
    nueva,
  };
}
