import { useState } from 'react';

// `motion/react-m` da los componentes sin la fabrica completa de `motion.*`,
// que es lo que de verdad recorta el bundle (medido: 124 -> 110,7 kB gz).
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Check, ChevronRight, Loader2 } from 'lucide-react';

import type { EventoPaso } from '@/shared/api/types';

/**
 * Las palabras las pone la interfaz, no el servidor: el backend manda el
 * nombre del nodo y unas cifras, y aqui se traducen. Asi se puede reescribir
 * una etiqueta sin tocar Python, y el backend no decide presentacion.
 */
const ETIQUETA: Record<string, string> = {
  reformular: 'Interpretando la pregunta',
  multiconsulta: 'Descomponiendo en subconsultas',
  buscar: 'Buscando en Qdrant',
  fusionar: 'Fusionando y deduplicando',
  evaluar: 'Evaluando el contexto',
  reescribir: 'Reescribiendo la consulta',
  construir: 'Redactando la respuesta',
};

function detalleDe(paso: EventoPaso): string | null {
  if (paso.subconsultas !== undefined) {
    return paso.subconsultas === 1
      ? '1 subconsulta'
      : `${paso.subconsultas} subconsultas`;
  }
  if (paso.fragmentos !== undefined) {
    return paso.fragmentos === 1 ? '1 fragmento' : `${paso.fragmentos} fragmentos`;
  }
  if (paso.score !== undefined) {
    // Se enseña el numero crudo y no un porcentaje: el score del reordenador
    // no esta acotado y convertirlo en "87%" seria inventarse una escala.
    const valor = paso.score.toFixed(2);
    return paso.pobre ? `contexto pobre (${valor})` : `relevancia ${valor}`;
  }
  if (paso.intento !== undefined) return `intento ${paso.intento}`;
  return null;
}

function duracion(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

type Props = {
  pasos: EventoPaso[];
  /** Mientras es true queda un paso en curso del que aun no se sabe el nombre. */
  enCurso: boolean;
};

/**
 * Lo que hace el agente antes de escribir una sola palabra.
 *
 * Importa porque ese hueco dura segundos de verdad: en una pregunta real son
 * ~3,5 s de grafo (descomponer la consulta y buscar en Qdrant) durante los que
 * antes no se veia nada y parecia que la aplicacion se habia colgado.
 *
 * Cada evento llega **cuando el paso ya ha terminado**: `updates` de LangGraph
 * no avisa de que algo empieza. Por eso lo que esta en curso es una fila
 * anonima al final, y no un paso con nombre: fingir que se sabe cual viene
 * seria mentir, porque el grafo tiene ramas condicionales.
 */
export function LineaTiempoAgente({ pasos, enCurso }: Props) {
  const [abierta, setAbierta] = useState(false);

  if (pasos.length === 0 && !enCurso) return null;

  const total = pasos.reduce((suma, paso) => suma + paso.ms, 0);
  // Mientras trabaja se despliega sola: es cuando aporta. Al terminar se
  // pliega a una linea, porque ya no es lo que se viene a leer.
  const desplegada = enCurso || abierta;

  return (
    <div className="mb-3 text-[0.8125rem]">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={desplegada}
        className="flex items-center gap-1.5 rounded-s py-0.5 text-tenue transition-colors hover:text-suave"
      >
        <ChevronRight
          size={13}
          className={`transition-transform duration-200 ${desplegada ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        {enCurso ? (
          <>
            <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" />
            <span>Trabajando…</span>
          </>
        ) : (
          <span>
            {pasos.length} {pasos.length === 1 ? 'paso' : 'pasos'}
            <span className="tabular font-mono"> · {duracion(total)}</span>
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {desplegada ? (
          <m.ol
            // `height: auto` animado: Motion mide el contenido, que es lo que
            // CSS no sabe hacer con una lista que crece mientras llega.
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1 ms-[6px] flex flex-col border-s border-borde ps-4">
              {pasos.map((paso, indice) => {
                const detalle = detalleDe(paso);
                return (
                  <li
                    key={`${paso.nodo}-${indice}`}
                    className="entra relative flex items-center gap-2 py-[3px]"
                    style={{ '--indice': indice } as React.CSSProperties}
                  >
                    <span
                      className="absolute -start-[21px] grid size-[11px] place-items-center rounded-full bg-superficie text-exito"
                      aria-hidden="true"
                    >
                      <Check size={9} strokeWidth={3.5} />
                    </span>
                    <span className="text-suave">{ETIQUETA[paso.nodo] ?? paso.nodo}</span>
                    {detalle ? (
                      <span className="tabular font-mono text-[0.6875rem] text-acento">
                        {detalle}
                      </span>
                    ) : null}
                    <span className="tabular ms-auto font-mono text-[0.6875rem] text-tenue">
                      {duracion(paso.ms)}
                    </span>
                  </li>
                );
              })}

              {enCurso ? (
                <li className="relative flex items-center gap-2 py-[3px]">
                  <span
                    className="absolute -start-[21px] size-[11px] rounded-full border-2 border-acento bg-superficie motion-safe:animate-pulse"
                    aria-hidden="true"
                  />
                  <span className="text-tenue">En curso…</span>
                </li>
              ) : null}
            </div>
          </m.ol>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
