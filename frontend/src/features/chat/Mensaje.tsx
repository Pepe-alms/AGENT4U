import { lazy, Suspense } from 'react';

import type { MensajeChat } from '@/features/chat/estado';
import { AccionesRespuesta } from '@/features/chat/AccionesRespuesta';
import { LineaTiempoAgente } from '@/features/chat/LineaTiempoAgente';

/**
 * El renderizador de markdown se trae aparte: `marked` y `dompurify` son 74 kB
 * y solo hacen falta cuando hay una respuesta en pantalla. Mientras llega, el
 * texto se enseña plano: es legible y evita un hueco.
 */
const Respuesta = lazy(() => import('@/features/chat/Respuesta'));

type Props = {
  mensaje: MensajeChat;
  /** Solo el mensaje cuyas fuentes se ven en el panel reacciona a las citas. */
  citaActiva: number | null;
  onElegirCita: (numero: number) => void;
  onApuntarCita: (numero: number | null) => void;
  /** Clave con la que se recuerda la valoracion de esta respuesta. */
  claveValoracion: string;
  onRegenerar: () => void;
};

export function Mensaje({
  mensaje,
  citaActiva,
  onElegirCita,
  onApuntarCita,
  claveValoracion,
  onRegenerar,
}: Props) {
  if (mensaje.rol === 'usuario') {
    return (
      <article className="flex justify-end" aria-label="Tu pregunta">
        {/* Burbuja GRIS y no negra: el negro relleno esta reservado a la
            accion principal, y una pregunta no es una accion. La posicion ya
            la distingue de la respuesta. */}
        <div className="max-w-[min(85%,36rem)] rounded-l bg-superficie-suave px-4 py-2.5 whitespace-pre-wrap text-texto">
          {mensaje.contenido}
        </div>
      </article>
    );
  }

  const escribiendo = mensaje.fase === 'escribiendo';
  // Sigue trabajando mientras no haya empezado a escribir: ahi es donde el
  // usuario necesita ver que esta pasando algo.
  const trabajando = escribiendo && !mensaje.contenido;

  return (
    <article className="flex flex-col" aria-label="Respuesta del agente">
      <LineaTiempoAgente pasos={mensaje.pasos ?? []} enCurso={trabajando} />

      {/* Sin burbuja y a ancho de lectura: es un texto para leer, no un chat
          de mensajeria. */}
      {mensaje.contenido ? (
        <div className="max-w-lectura">
          <Suspense fallback={<p className="whitespace-pre-wrap">{mensaje.contenido}</p>}>
            <Respuesta
              texto={mensaje.contenido}
              escribiendo={escribiendo}
              fuentes={mensaje.fuentes ?? []}
              citaActiva={citaActiva}
              onElegirCita={onElegirCita}
              onApuntarCita={onApuntarCita}
            />
          </Suspense>
        </div>
      ) : null}

      {/* El motivo del corte va aparte del texto: asi se conserva lo que el
          modelo llego a escribir y ademas se explica por que se paro. */}
      {mensaje.motivoError ? (
        <p
          className="mt-3 max-w-lectura rounded-m border border-aviso-borde bg-aviso-fondo px-3 py-2 text-sm text-aviso"
          role="alert"
        >
          {mensaje.contenido ? 'La respuesta se cortó: ' : ''}
          {mensaje.motivoError}
        </p>
      ) : null}

      {/* Las acciones solo aparecen cuando la respuesta esta terminada: un
          boton de copiar a mitad del stream copiaria media frase. */}
      {!escribiendo && mensaje.contenido ? (
        <AccionesRespuesta
          mensaje={mensaje}
          clave={claveValoracion}
          onRegenerar={onRegenerar}
        />
      ) : null}
    </article>
  );
}
