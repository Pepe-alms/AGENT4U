import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import {
  agruparComandos,
  filtrarComandos,
  type Comando,
} from '@/features/comandos/comandos';
import { TECLA_MODIFICADORA } from '@/shared/hooks/useAtajo';

type Props = {
  abierta: boolean;
  alCerrar: () => void;
  comandos: Comando[];
};

export function PaletaComandos({ abierta, alCerrar, comandos }: Props) {
  const referencia = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogo = referencia.current;
    if (!dialogo) return;
    if (abierta && !dialogo.open) dialogo.showModal();
    if (!abierta && dialogo.open) dialogo.close();
  }, [abierta]);

  // El evento 'close' se escucha en el DOM y no con la prop: no burbujea, y si
  // no llegase a React el padre se quedaría creyendo que sigue abierta.
  useEffect(() => {
    const dialogo = referencia.current;
    if (!dialogo) return;
    const alCerrarNativo = () => alCerrar();
    dialogo.addEventListener('close', alCerrarNativo);
    return () => dialogo.removeEventListener('close', alCerrarNativo);
  }, [alCerrar]);

  return (
    <dialog
      ref={referencia}
      /* Anclada arriba y no centrada: la paleta aparece bajo la mano, no en
         mitad de la pantalla, y la lista crece hacia abajo sin moverla. */
      className="fixed top-[12vh] left-1/2 hidden max-h-[70dvh] w-[min(38rem,92vw)] max-w-none -translate-x-1/2 flex-col overflow-hidden rounded-m border border-borde bg-superficie p-0 text-texto shadow-l backdrop:bg-black/25 backdrop:backdrop-blur-sm open:flex motion-safe:open:animate-[entrar-paleta_180ms_var(--curva-entrada)]"
      aria-label="Paleta de comandos"
      onClick={(evento) => {
        if (evento.target === referencia.current) alCerrar();
      }}
    >
      {/*
        El contenido solo existe mientras la paleta está abierta, así que su
        estado (búsqueda y opción activa) nace limpio en cada apertura. Es
        mejor que resetearlo desde un efecto: ahí React avisa, con razón, de
        que se está provocando un render en cascada.
      */}
      {abierta ? <Contenido comandos={comandos} alCerrar={alCerrar} /> : null}
    </dialog>
  );
}

function Contenido({
  comandos,
  alCerrar,
}: {
  comandos: Comando[];
  alCerrar: () => void;
}) {
  const lista = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState('');
  const [activo, setActivo] = useState(0);

  const visibles = useMemo(() => filtrarComandos(comandos, texto), [comandos, texto]);
  const grupos = useMemo(() => agruparComandos(visibles), [visibles]);

  // La opción activa se trae a la vista al moverse con las flechas; si no, se
  // navega a ciegas en cuanto la lista pasa del alto visible.
  useEffect(() => {
    lista.current
      ?.querySelector(`[data-indice='${activo}']`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activo]);

  function ejecutar(comando: Comando | undefined) {
    if (!comando) return;
    alCerrar();
    comando.ejecutar();
  }

  function alPulsar(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (visibles.length === 0) return;
      const paso = evento.key === 'ArrowDown' ? 1 : -1;
      // Da la vuelta por los dos extremos: bajar desde el último lleva al
      // primero, que es lo que hace cualquier paleta.
      setActivo((actual) => (actual + paso + visibles.length) % visibles.length);
    }

    if (evento.key === 'Enter') {
      evento.preventDefault();
      ejecutar(visibles[activo]);
    }
  }

  // Índice global, para que las flechas recorran los grupos de corrido.
  let posicion = -1;

  return (
    <>
      <input
        className="h-14 shrink-0 border-b border-borde bg-transparent px-5 text-base text-texto placeholder:text-tenue focus:outline-none"
        value={texto}
        autoFocus
        placeholder="Busca una acción o una conversación…"
        aria-label="Buscar comandos"
        // El input hace de mando a distancia de la lista: el foco se queda
        // aquí mientras las flechas mueven la selección de abajo.
        role="combobox"
        aria-expanded
        aria-controls="lista-comandos"
        aria-activedescendant={
          visibles[activo] ? `comando-${visibles[activo].id}` : undefined
        }
        onChange={(evento) => {
          setTexto(evento.target.value);
          setActivo(0);
        }}
        onKeyDown={alPulsar}
      />

      <div
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
        id="lista-comandos"
        role="listbox"
        ref={lista}
      >
        {visibles.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-tenue">
            Nada coincide con «{texto}».
          </p>
        ) : (
          grupos.map(({ grupo, comandos: delGrupo }) => (
            <div key={grupo}>
              <p className="etiqueta-seccion px-2.5 pt-2 pb-1">{grupo}</p>
              {delGrupo.map((comando) => {
                posicion += 1;
                const indice = posicion;
                return (
                  <button
                    key={comando.id}
                    id={`comando-${comando.id}`}
                    type="button"
                    role="option"
                    aria-selected={indice === activo}
                    data-indice={indice}
                    className={[
                      'flex w-full items-center gap-3 rounded-s px-2.5 py-2 text-start',
                      indice === activo ? 'bg-acento-suave text-texto' : 'text-suave',
                    ].join(' ')}
                    // El ratón mueve la selección en vez de tener su propio
                    // resalte: así solo hay una cosa marcada a la vez.
                    onMouseMove={() => setActivo(indice)}
                    onClick={() => ejecutar(comando)}
                    tabIndex={-1}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {comando.titulo}
                      </span>
                      {comando.detalle ? (
                        <span className="truncate text-[0.6875rem] text-tenue">
                          {comando.detalle}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-borde px-4 py-2.5 text-[0.75rem] text-tenue">
        <span className="flex items-center gap-1">
          <Tecla>↑</Tecla> <Tecla>↓</Tecla> moverse
        </span>
        <span className="flex items-center gap-1">
          <Tecla>Enter</Tecla> abrir
        </span>
        <span className="flex items-center gap-1">
          <Tecla>Esc</Tecla> cerrar
        </span>
        <span className="ms-auto">
          <Tecla>{`${TECLA_MODIFICADORA} K`}</Tecla>
        </span>
      </div>
    </>
  );
}

function Tecla({ children }: { children: string }) {
  return (
    <kbd className="rounded-s border border-borde px-1.5 py-px font-mono text-[0.6875rem]">
      {children}
    </kbd>
  );
}
