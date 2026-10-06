import { useCallback } from 'react';

import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { X } from 'lucide-react';

import { useLocation, useNavigate, useParams } from 'react-router';

import { AnteriorSiguiente } from '@/sitio/componentes/AnteriorSiguiente';
import { CabeceraPagina } from '@/sitio/componentes/CabeceraPagina';
import { Migas } from '@/sitio/componentes/Migas';
import { Revelar } from '@/sitio/componentes/Revelar';
import { ENLACES, FLUJO_INGESTA, NODOS } from '@/sitio/datos/arquitectura';
import { rutaPorId } from '@/routes';
import { useScrollToHash } from '@/sitio/useScrollToHash';

/** El lienzo del diagrama. Las coordenadas de los nodos viven en los datos. */
const LIENZO = { ancho: 900, alto: 520 };
const ALTO_NODO = 72;
const ANCHO_NODO = 170;

/** El centro de un nodo, para tirar las flechas de centro a centro. */
function centroDe(id: string) {
  const nodo = NODOS.find((n) => n.id === id);
  if (!nodo) return null;
  return {
    x: nodo.x + (nodo.ancho ?? ANCHO_NODO) / 2,
    y: nodo.y + ALTO_NODO / 2,
    ancho: nodo.ancho ?? ANCHO_NODO,
  };
}

/**
 * Recorta la linea para que nazca y muera en el BORDE de cada caja y no en su
 * centro: una flecha que sale de debajo del texto se lee como un error de
 * dibujo. El recorte es rectangular, con el mismo factor en los dos ejes.
 */
function tramo(desdeId: string, hastaId: string) {
  const a = centroDe(desdeId);
  const b = centroDe(hastaId);
  if (!a || !b) return null;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distancia = Math.hypot(dx, dy) || 1;

  const recorte = (ancho: number) => {
    const porX = Math.abs(dx) > 1 ? (ancho / 2 + 10) / Math.abs(dx) : Infinity;
    const porY = Math.abs(dy) > 1 ? (ALTO_NODO / 2 + 10) / Math.abs(dy) : Infinity;
    return Math.min(porX, porY, 0.45);
  };

  const ra = recorte(a.ancho);
  const rb = recorte(b.ancho);

  return {
    x1: a.x + dx * ra,
    y1: a.y + dy * ra,
    x2: b.x - dx * rb,
    y2: b.y - dy * rb,
    mx: a.x + dx / 2,
    my: a.y + dy / 2,
    distancia,
  };
}

function Diagrama({
  elegido,
  onElegir,
}: {
  elegido: string | null;
  onElegir: (id: string | null) => void;
}) {
  return (
    <svg
      viewBox={`0 0 ${LIENZO.ancho} ${LIENZO.alto}`}
      className="w-full"
      role="group"
      aria-label="Diagrama de componentes del sistema"
    >
      <defs>
        <marker
          id="punta"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--txt-tenue)" />
        </marker>
      </defs>

      {ENLACES.map((enlace) => {
        const t = tramo(enlace.de, enlace.a);
        if (!t) return null;
        // La flecha se enciende cuando uno de sus dos extremos esta elegido:
        // asi al pulsar un nodo se ve de que depende y quien depende de el.
        const activa = elegido === enlace.de || elegido === enlace.a;

        return (
          <g key={`${enlace.de}-${enlace.a}`}>
            <line
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke={activa ? 'var(--txt)' : 'var(--borde)'}
              strokeWidth={activa ? 1.5 : 1}
              markerEnd="url(#punta)"
              className="transition-[stroke] duration-200"
            />
            {enlace.etiqueta ? (
              <text
                x={t.mx}
                y={t.my - 6}
                textAnchor="middle"
                className="font-mono"
                fontSize="11"
                fill="var(--txt-tenue)"
              >
                {enlace.etiqueta}
              </text>
            ) : null}
          </g>
        );
      })}

      {NODOS.map((nodo) => {
        const ancho = nodo.ancho ?? ANCHO_NODO;
        const activo = elegido === nodo.id;

        return (
          <g
            key={nodo.id}
            role="button"
            tabIndex={0}
            aria-pressed={activo}
            aria-label={`${nodo.nombre}: ${nodo.rol}`}
            className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
            onClick={() => onElegir(activo ? null : nodo.id)}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter' || evento.key === ' ') {
                evento.preventDefault();
                onElegir(activo ? null : nodo.id);
              }
            }}
          >
            <rect
              x={nodo.x}
              y={nodo.y}
              width={ancho}
              height={ALTO_NODO}
              rx="6"
              fill={activo ? 'var(--txt)' : 'var(--superficie)'}
              stroke={activo ? 'var(--txt)' : 'var(--borde)'}
              className="transition-[fill,stroke] duration-200"
            />
            <text
              x={nodo.x + 16}
              y={nodo.y + 30}
              fontSize="15"
              fontWeight="500"
              fill={activo ? 'var(--acento-texto)' : 'var(--txt)'}
              className="transition-[fill] duration-200"
            >
              {nodo.nombre}
            </text>
            <text
              x={nodo.x + 16}
              y={nodo.y + 50}
              fontSize="12"
              fill={activo ? 'var(--acento-texto)' : 'var(--txt-tenue)'}
              className="transition-[fill] duration-200"
            >
              {nodo.rol}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PanelNodo({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const nodo = NODOS.find((n) => n.id === id);
  if (!nodo) return null;

  return (
    <m.aside
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
      className="flex flex-col gap-5 rounded-m border border-borde p-6"
      aria-label={`Detalle de ${nodo.nombre}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-[1.375rem] font-medium tracking-[-0.02em]">
            {nodo.nombre}
          </h3>
          <p className="font-mono text-[0.8125rem] text-tenue">{nodo.tecnologia}</p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar el detalle"
          className="grid size-8 shrink-0 place-items-center rounded-full text-suave transition-colors hover:bg-superficie-suave hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[0.8125rem] font-medium text-tenue">Responsabilidad</p>
        <p className="text-suave">{nodo.responsabilidad}</p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-[0.8125rem] font-medium text-tenue">Decisiones</p>
        <ul className="flex flex-col gap-3">
          {nodo.decisiones.map((decision) => (
            <li
              key={decision}
              className="border-s-2 border-borde ps-3 text-[0.9375rem] text-suave"
            >
              {decision}
            </li>
          ))}
        </ul>
      </div>
    </m.aside>
  );
}

/** El flujo de ingesta, como linea de tiempo horizontal. */
function FlujoIngesta() {
  return (
    <section className="border-t border-borde py-16 sm:py-20">
      <Revelar>
        <p className="text-[0.875rem] font-medium text-suave">Camino de entrada</p>
      </Revelar>
      <Revelar indice={1}>
        <h2 className="mt-3 max-w-[26ch] text-[clamp(1.5rem,1.1rem+1.4vw,1.75rem)] font-semibold tracking-[-0.02em]">
          Cómo entra un documento en el índice.
        </h2>
      </Revelar>

      <ol className="relative mt-10 flex flex-col gap-8 md:grid md:grid-cols-4 md:gap-6">
        {/* El conector: vertical en movil, horizontal desde `md`. Dos piezas y
            no una con clases responsive, como en el pipeline de la portada. */}
        <div
          className="absolute start-[7px] top-2 bottom-2 w-px bg-borde md:hidden"
          aria-hidden="true"
        />
        <div
          className="absolute top-[7px] hidden h-px w-full bg-borde md:block"
          aria-hidden="true"
        />

        {FLUJO_INGESTA.map((paso, indice) => (
          <Revelar
            key={paso.titulo}
            indice={indice}
            como="li"
            className="relative flex gap-4 md:flex-col md:gap-4"
          >
            <>
              <span
                className="mt-[3px] size-[15px] shrink-0 rounded-full border-4 border-fondo bg-texto md:mt-0"
                aria-hidden="true"
              />
              <span className="flex flex-col gap-1.5">
                <span className="block text-[0.8125rem] text-tenue">
                  Paso {indice + 1}
                </span>
                <span className="block text-[1.0625rem] font-medium">{paso.titulo}</span>
                <span className="block text-[0.9375rem] text-suave">{paso.detalle}</span>
              </span>
            </>
          </Revelar>
        ))}
      </ol>
    </section>
  );
}

export function Arquitectura() {
  // El ancla del hash, con la pagina ya montada: ver useScrollToHash.
  useScrollToHash();

  const ruta = rutaPorId('arquitectura')!;
  /*
   * El componente abierto vive en la URL y no en un `useState`.
   *
   * Es lo que convierte "mira el diagrama y pulsa Qdrant" en un enlace que se
   * manda por chat: /arquitectura/qdrant se comparte, se recarga y aparece en
   * el historial. Como estado interno no haria ninguna de las tres cosas.
   */
  const { componente } = useParams<{ componente: string }>();
  const navegar = useNavigate();
  const ubicacion = useLocation();

  // Un id inventado en la URL no abre nada en vez de romper la pagina.
  const elegido = NODOS.some((n) => n.id === componente) ? (componente ?? null) : null;

  /*
   * Abrir y cerrar el panel, cuidando el historial.
   *
   * Hay DOS formas de llegar a /arquitectura/qdrant y cada una necesita una
   * salida distinta:
   *
   *   1. Pulsando un nodo desde la propia pagina. El paso anterior del
   *      historial es /arquitectura, asi que cerrar es literalmente volver
   *      atras: `navigate(-1)`. Se marca con `state.desdePanel` al abrir.
   *
   *   2. Entrando por un enlace compartido. Aqui no hay nada detras a lo que
   *      volver, asi que cerrar REEMPLAZA por /arquitectura.
   *
   * El intento anterior —abrir apila, cerrar apila /arquitectura— dejaba el
   * historial en [/arquitectura, /arquitectura] y el siguiente "atras" no
   * hacia nada visible: un paso muerto.
   */
  const abrir = useCallback(
    (id: string) => {
      navegar(`${ruta.path}/${id}`, { state: { desdePanel: true } });
    },
    [navegar, ruta.path],
  );

  const cerrar = useCallback(() => {
    const abiertoDesdeLaPagina = (ubicacion.state as { desdePanel?: boolean } | null)
      ?.desdePanel;
    if (abiertoDesdeLaPagina) navegar(-1);
    else navegar(ruta.path, { replace: true });
  }, [navegar, ruta.path, ubicacion.state]);

  const elegir = useCallback(
    (id: string | null) => {
      if (id) abrir(id);
      else cerrar();
    },
    [abrir, cerrar],
  );

  return (
    <>
      <Migas id={elegido ? 'arquitectura-componente' : 'arquitectura'} />
      <CabeceraPagina
        eyebrow={ruta.eyebrow!}
        titulo={ruta.titulo!}
        entradilla={ruta.entradilla!}
        paleta={ruta.paleta!}
        forma={ruta.forma}
      />

      <section className="py-16 sm:py-20">
        <Revelar>
          <p className="text-[0.875rem] font-medium text-suave">El mapa</p>
        </Revelar>
        <Revelar indice={1}>
          <p className="mt-3 max-w-[58ch] text-suave">
            Pulsa cualquier pieza para ver de qué se ocupa, con qué está construida y qué
            se decidió al elegirla. Las flechas que salen y entran se encienden con ella.
          </p>
        </Revelar>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Revelar className="min-w-0 overflow-x-auto">
            <div className="min-w-[46rem] rounded-m border border-borde p-4">
              <Diagrama elegido={elegido} onElegir={elegir} />
            </div>
          </Revelar>

          {/*
            El panel vive fuera del diagrama y no dentro: en un SVG no cabe
            texto que fluya, y meterlo con `foreignObject` da un bloque que no
            se puede seleccionar ni leer bien con un lector de pantalla.
          */}
          <AnimatePresence mode="wait">
            {elegido ? (
              <PanelNodo key={elegido} id={elegido} onCerrar={cerrar} />
            ) : (
              <m.div
                key="vacio"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-center justify-center rounded-m border border-dashed border-borde p-6 text-center"
              >
                <p className="max-w-[26ch] text-[0.9375rem] text-tenue">
                  Ninguna pieza seleccionada. Pulsa una del diagrama.
                </p>
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <FlujoIngesta />
      <AnteriorSiguiente id="arquitectura" />
    </>
  );
}

export default Arquitectura;
