import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { ArrowUp, Square } from 'lucide-react';

type Props = {
  enviando: boolean;
  onEnviar: (pregunta: string) => void;
  onDetener: () => void;
};

/** Ocho lineas. A partir de ahi el campo hace scroll en vez de seguir
 *  creciendo: si no, se come la conversacion entera. */
const LINEAS_MAXIMAS = 8;

/**
 * Trae el renderizador de markdown por adelantado. Se llama al enfocar el
 * campo: quien va a escribir va a necesitarlo en unos segundos, y pedirlo
 * ahora evita que la primera respuesta aparezca un instante sin formato.
 */
function precargarRespuesta() {
  void import('@/features/chat/Respuesta');
}

export function Composer({ enviando, onEnviar, onDetener }: Props) {
  const [texto, setTexto] = useState('');
  const campo = useRef<HTMLTextAreaElement>(null);

  // La altura se recalcula en layout, antes de pintar: si se hiciera en un
  // efecto normal se veria el salto de una linea a dos.
  useLayoutEffect(() => {
    const area = campo.current;
    if (!area) return;
    area.style.height = 'auto';
    const linea = parseFloat(getComputedStyle(area).lineHeight) || 24;
    const tope = linea * LINEAS_MAXIMAS;
    area.style.height = `${Math.min(area.scrollHeight, tope)}px`;
    area.style.overflowY = area.scrollHeight > tope ? 'auto' : 'hidden';
  }, [texto]);

  function enviar() {
    if (!texto.trim() || enviando) return;
    onEnviar(texto);
    setTexto('');
  }

  function alPulsarTecla(evento: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia y Shift+Enter salta de linea. Se ignora mientras el IME
    // esta componiendo, o se enviaria a medias al escribir en japones o chino.
    if (evento.key === 'Enter' && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      enviar();
    }
  }

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(evento) => {
        evento.preventDefault();
        enviar();
      }}
    >
      {/*
        El foco se pinta como un halo alrededor de toda la caja, al estilo de
        iOS, y con `focus-within` en el contenedor y no en el textarea para que
        rodee tambien al boton de enviar.
      */}
      <div className="borde-marca group relative flex items-end gap-2 rounded-l border border-borde bg-superficie p-2 transition-colors">
        <label htmlFor="pregunta" className="solo-lectores">
          Escribe tu pregunta
        </label>
        <textarea
          id="pregunta"
          ref={campo}
          rows={1}
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          onKeyDown={alPulsarTecla}
          onFocus={precargarRespuesta}
          placeholder="Pregunta lo que quieras sobre tus documentos…"
          className={[
            'min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1.5',
            'text-texto placeholder:text-tenue focus:outline-none',
            'text-base',
          ].join(' ')}
        />

        {/* Un solo boton que cambia de papel. Dos botones (enviar + detener)
            obligarian a decidir cual esta activo mirando el estado. */}
        {enviando ? (
          <button
            type="button"
            onClick={onDetener}
            aria-label="Detener la respuesta"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-borde text-suave transition-colors hover:bg-superficie-suave hover:text-texto"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!texto.trim()}
            aria-label="Enviar la pregunta"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-acento text-sobre-acento transition-colors hover:bg-acento-hover disabled:pointer-events-none disabled:bg-superficie-suave disabled:text-tenue"
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Discreta y solo donde hay teclado fisico: en movil no significa nada. */}
      <p className="hidden px-1 text-[0.6875rem] text-tenue sm:block">
        <Tecla>Enter</Tecla> envía · <Tecla>Shift</Tecla> + <Tecla>Enter</Tecla> salta de
        línea
      </p>
    </form>
  );
}

function Tecla({ children }: { children: string }) {
  return (
    <kbd className="rounded-s border border-borde px-1.5 py-px font-mono text-[0.6875rem]">
      {children}
    </kbd>
  );
}
