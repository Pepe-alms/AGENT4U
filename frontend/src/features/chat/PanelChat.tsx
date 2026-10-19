import { useEffect, useRef, useState } from 'react';

import { ArrowDown } from 'lucide-react';

import { Bienvenida } from '@/features/chat/Bienvenida';
import { Composer } from '@/features/chat/Composer';
import { Mensaje } from '@/features/chat/Mensaje';
import type { Conversacion } from '@/features/chat/useConversacion';
import { claveValoracion } from '@/shared/lib/valoraciones';
import { Button } from '@/shared/ui/Button';

/** Margen para considerar que el usuario esta "al fondo" del hilo. */
const MARGEN_FONDO = 80;

type PropsPanel = {
  conversacion: Conversacion;
  citaActiva: number | null;
  onElegirCita: (numero: number) => void;
  onApuntarCita: (numero: number | null) => void;
  backendCaido: boolean;
  hayDocumentos: boolean | null;
  onVerDocumentos: () => void;
  /** Para contarle a un lector de pantalla lo que ha pasado. */
  onAnunciar: (texto: string) => void;
};

export function PanelChat({
  conversacion,
  citaActiva,
  onElegirCita,
  onApuntarCita,
  backendCaido,
  hayDocumentos,
  onVerDocumentos,
  onAnunciar,
}: PropsPanel) {
  const {
    mensajes,
    enviando,
    error,
    puedeReintentar,
    abriendo,
    enviar,
    detener,
    reintentar,
  } = conversacion;
  const zona = useRef<HTMLDivElement>(null);
  const pegadoAlFondo = useRef(true);
  const [alFondo, setAlFondo] = useState(true);
  const vacio = mensajes.length === 0 && !abriendo;

  // El panel de fuentes muestra las del ultimo mensaje que tenga: solo ese
  // mensaje puede resaltar sus citas, o un [1] de una respuesta vieja
  // encenderia la fuente de otra.
  const idConFuentes = mensajes.findLast(
    (m) => m.rol === 'agente' && m.fuentes?.length,
  )?.id;

  // Se anota si el usuario esta al fondo cada vez que hace scroll. Es la clave
  // de que el auto-scroll no secuestre: si habia subido a leer, al llegar
  // texto nuevo no se le mueve la vista.
  useEffect(() => {
    const nodo = zona.current;
    if (!nodo) return;

    const alHacerScroll = () => {
      const restante = nodo.scrollHeight - nodo.scrollTop - nodo.clientHeight;
      const pegado = restante < MARGEN_FONDO;
      pegadoAlFondo.current = pegado;
      // El estado solo alimenta el boton de "ir al final". La decision de
      // auto-scroll usa la ref, que esta siempre al dia sin re-renderizar.
      setAlFondo(pegado);
    };

    nodo.addEventListener('scroll', alHacerScroll, { passive: true });
    return () => nodo.removeEventListener('scroll', alHacerScroll);
  }, []);

  useEffect(() => {
    const nodo = zona.current;
    if (!nodo || !pegadoAlFondo.current) return;
    nodo.scrollTop = nodo.scrollHeight;
  }, [mensajes]);

  // La respuesta se escribe sola en pantalla, pero quien no la ve necesita que
  // alguien le diga cuando ha terminado. Leerla entera por `aria-live`
  // mientras llega seria insoportable: se avisa al acabar.
  const ultimo = mensajes.at(-1);
  const faseUltimo = ultimo?.rol === 'agente' ? ultimo.fase : null;
  useEffect(() => {
    if (faseUltimo === 'completo') onAnunciar('Respuesta lista.');
    if (faseUltimo === 'detenido') onAnunciar('Respuesta detenida.');
    if (faseUltimo === 'error') onAnunciar('La respuesta ha fallado.');
  }, [faseUltimo, onAnunciar]);

  const avisoError = error ? (
    <div
      className="mx-auto flex w-full max-w-lectura items-start gap-3 rounded-m border border-error-borde bg-error-fondo p-3 text-[0.9375rem] text-error"
      role="alert"
    >
      <p className="flex-1">{error}</p>
      {puedeReintentar ? (
        <Button variante="secundario" tamano="sm" onClick={reintentar}>
          Reintentar
        </Button>
      ) : null}
    </div>
  ) : null;

  /*
   * Sin conversacion, el composer va **dentro** del bloque centrado y no
   * anclado abajo. Antes quedaban ~400px muertos entre el titular y el campo,
   * que es el hueco que separa una pantalla de bienvenida de una pantalla
   * vacia. Con mensajes vuelve al pie, que es donde se espera.
   */
  if (vacio) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[42rem] flex-1 flex-col justify-center gap-6 px-4 py-8">
          <Bienvenida
            backendCaido={backendCaido}
            hayDocumentos={hayDocumentos}
            onPreguntar={enviar}
            onVerDocumentos={onVerDocumentos}
          />
          {!backendCaido ? (
            <Composer enviando={enviando} onEnviar={enviar} onDetener={detener} />
          ) : null}
          {avisoError}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto" ref={zona}>
          <div className="mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-4 py-6">
            {abriendo ? (
              <p className="text-sm text-tenue" aria-busy="true" aria-live="polite">
                Abriendo la conversación…
              </p>
            ) : (
              mensajes.map((mensaje, indice) => (
                <Mensaje
                  key={mensaje.id}
                  mensaje={mensaje}
                  citaActiva={mensaje.id === idConFuentes ? citaActiva : null}
                  onElegirCita={onElegirCita}
                  onApuntarCita={onApuntarCita}
                  claveValoracion={claveValoracion(conversacion.id, indice)}
                  onRegenerar={() => conversacion.regenerar(mensaje.id)}
                />
              ))
            )}
            {avisoError}
          </div>
        </div>

        {/* Solo aparece si el usuario se ha ido hacia arriba: si esta al
            fondo no hay nada a donde ir. */}
        {!alFondo ? (
          <button
            type="button"
            onClick={() => {
              const nodo = zona.current;
              if (nodo) nodo.scrollTo({ top: nodo.scrollHeight, behavior: 'smooth' });
            }}
            className="entra absolute bottom-3 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-borde bg-superficie text-suave transition-colors hover:bg-superficie-suave hover:text-texto"
            aria-label="Ir al final de la conversación"
          >
            <ArrowDown size={16} />
          </button>
        ) : null}
      </div>

      <div className="shrink-0 px-4 pb-3">
        <div className="mx-auto w-full max-w-[52rem]">
          <Composer enviando={enviando} onEnviar={enviar} onDetener={detener} />
        </div>
      </div>
    </div>
  );
}
