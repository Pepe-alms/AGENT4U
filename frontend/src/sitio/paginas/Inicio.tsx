import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AnimatePresence, useInView, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { ArrowUp, Search } from 'lucide-react';

import { ArticleCard } from '@/sitio/componentes/ArticleCard';
import { Revelar } from '@/sitio/componentes/Revelar';
import { AnteriorSiguiente } from '@/sitio/componentes/AnteriorSiguiente';
import { RUTA_APP, RUTAS_NAV } from '@/routes';
import {
  DEMO_FUENTES,
  DEMO_PREGUNTA,
  DEMO_RESPUESTA,
  FRAGMENTOS_EJEMPLO,
  METRICAS,
  MS_BORRANDO,
  MS_PAUSA_FINAL,
  MS_POR_CARACTER,
  MS_POR_TOKEN,
  PASOS,
  PREGUNTAS_PLACEHOLDER,
  QUE_PREGUNTAR,
  SUBTITULO,
  SUGERENCIAS,
  TITULAR,
  ULTIMA_ACTUALIZACION,
  type Paso,
} from '@/sitio/datos/inicio';

/* ============================================================================
 * UTILIDADES
 * ==========================================================================*/

/** Foco visible comun. Va en una constante para no repetirlo en cada control. */
const FOCO =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto';

/** La revelacion al entrar en pantalla: fade y 8px. Nada mas. */
const REVELAR = {
  initial: { opacity: 0, y: 8 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.4, ease: [0, 0, 0.2, 1] as const },
};

/**
 * Escribe y borra las preguntas en bucle.
 *
 * Devuelve la cadena a medio escribir. Con `prefers-reduced-motion` no anima:
 * se queda con la primera pregunta entera, que es el estado final util.
 */
function usePlaceholderMaquina(preguntas: string[], activo: boolean): string {
  const sinMovimiento = useReducedMotion();
  const [texto, setTexto] = useState(() => (sinMovimiento ? (preguntas[0] ?? '') : ''));

  useEffect(() => {
    if (sinMovimiento || !activo) return;

    let indice = 0;
    let letras = 0;
    let borrando = false;
    let reloj: ReturnType<typeof setTimeout>;

    const paso = () => {
      const frase = preguntas[indice] ?? '';

      if (!borrando) {
        letras += 1;
        setTexto(frase.slice(0, letras));
        if (letras === frase.length) {
          borrando = true;
          reloj = setTimeout(paso, MS_PAUSA_FINAL);
          return;
        }
        reloj = setTimeout(paso, MS_POR_CARACTER);
        return;
      }

      letras -= 1;
      setTexto(frase.slice(0, letras));
      if (letras === 0) {
        borrando = false;
        indice = (indice + 1) % preguntas.length;
      }
      reloj = setTimeout(paso, MS_BORRANDO);
    };

    reloj = setTimeout(paso, MS_POR_CARACTER);
    return () => clearTimeout(reloj);
  }, [preguntas, activo, sinMovimiento]);

  return texto;
}

/**
 * Cuenta de 0 a `hasta` cuando el elemento entra en pantalla.
 *
 * El numero se formatea con separador de miles local. Con movimiento reducido
 * aparece directamente el valor final: la cifra es el dato, la cuenta es el
 * adorno.
 */
function Contador({ hasta, sufijo = '' }: { hasta: number; sufijo?: string }) {
  const sinMovimiento = useReducedMotion();
  const referencia = useRef<HTMLSpanElement>(null);
  const visible = useInView(referencia, { once: true, margin: '-40px' });
  const [valor, setValor] = useState(0);

  useEffect(() => {
    // Con movimiento reducido no hay nada que animar: el valor se deriva mas
    // abajo. Escribirlo aqui seria un setState sincrono dentro de un efecto,
    // que es un render en cascada por nada.
    if (!visible || sinMovimiento) return;

    const DURACION = 900;
    const arranque = performance.now();
    let cuadro = 0;

    const avanzar = (ahora: number) => {
      const avance = Math.min((ahora - arranque) / DURACION, 1);
      // Ease-out cubico: arranca rapido y frena. Sin rebote.
      setValor(Math.round(hasta * (1 - (1 - avance) ** 3)));
      if (avance < 1) cuadro = requestAnimationFrame(avanzar);
    };

    cuadro = requestAnimationFrame(avanzar);
    return () => cancelAnimationFrame(cuadro);
  }, [visible, hasta, sinMovimiento]);

  const mostrado = sinMovimiento ? hasta : valor;

  return (
    <span ref={referencia} className="tabular">
      {mostrado.toLocaleString('es-ES')}
      {sufijo}
    </span>
  );
}

/* ============================================================================
 * HERO
 * ==========================================================================*/

function Hero() {
  const [valor, setValor] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  // El placeholder solo se escribe mientras el campo esta vacio: superponer el
  // texto animado a lo que el usuario escribe es ilegible.
  const placeholder = usePlaceholderMaquina(PREGUNTAS_PLACEHOLDER, valor === '');

  const rellenar = useCallback((texto: string) => {
    setValor(texto);
    campo.current?.focus();
  }, []);

  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-32">
      <div className="mx-auto flex max-w-[44rem] flex-col items-center gap-6 text-center">
        <m.h1
          {...REVELAR}
          tabIndex={-1}
          className="text-[clamp(2.25rem,1.6rem+2.6vw,3rem)] leading-[1.16] font-medium tracking-[-0.03em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-texto"
        >
          {TITULAR}
        </m.h1>

        <m.p
          {...REVELAR}
          transition={{ ...REVELAR.transition, delay: 0.06 }}
          className="max-w-[46ch] text-balance text-suave"
        >
          {SUBTITULO}
        </m.p>

        {/* La unica sombra del documento. Todo lo demas se separa con hairline. */}
        <m.form
          {...REVELAR}
          transition={{ ...REVELAR.transition, delay: 0.12 }}
          className="mt-2 w-full"
          onSubmit={(evento) => {
            evento.preventDefault();
            // Navegacion dura y no `navigate`: /app es la aplicacion, otro
            // arbol de React. Entrar con el router la montaria dentro del
            // layout del sitio, con su barra y su pie encima.
            if (valor.trim()) window.location.assign(RUTA_APP);
          }}
        >
          <div className="relative flex items-center">
            <Search
              size={18}
              strokeWidth={1.5}
              className="pointer-events-none absolute start-5 text-tenue"
              aria-hidden="true"
            />
            <input
              ref={campo}
              type="text"
              value={valor}
              onChange={(evento) => setValor(evento.target.value)}
              placeholder={placeholder}
              aria-label="Escribe una pregunta sobre tus documentos"
              className={`h-14 w-full rounded-full border border-borde bg-superficie ps-13 pe-14 text-base text-texto shadow-[rgba(0,0,0,0.02)_0_4px_6px,rgba(0,0,0,0.05)_0_0_2px] transition-colors placeholder:text-tenue focus:border-borde-fuerte focus:outline-none ${FOCO}`}
            />
            <button
              type="submit"
              aria-label="Preguntar"
              disabled={!valor.trim()}
              className={`absolute end-2.5 grid size-9 place-items-center rounded-full bg-acento text-sobre-acento transition-colors hover:bg-acento-hover disabled:bg-superficie-suave disabled:text-tenue ${FOCO}`}
            >
              <ArrowUp size={18} strokeWidth={1.5} />
            </button>
          </div>
        </m.form>

        <m.ul
          {...REVELAR}
          transition={{ ...REVELAR.transition, delay: 0.18 }}
          className="flex flex-wrap justify-center gap-2"
        >
          {SUGERENCIAS.map((sugerencia) => (
            <li key={sugerencia}>
              <button
                type="button"
                onClick={() => rellenar(sugerencia)}
                className={`rounded-full border border-borde px-4 py-2 text-[0.875rem] font-medium transition-colors hover:bg-superficie-suave ${FOCO}`}
              >
                {sugerencia}
              </button>
            </li>
          ))}
        </m.ul>
      </div>
    </section>
  );
}

/* ============================================================================
 * PIPELINE
 * ==========================================================================*/

/** El vector: una fila de numeros que late. Es el ejemplo del paso 2. */
function EjemploVector() {
  const sinMovimiento = useReducedMotion();
  const [semilla, setSemilla] = useState(0);

  useEffect(() => {
    if (sinMovimiento) return;
    const reloj = setInterval(() => setSemilla((s) => s + 1), 900);
    return () => clearInterval(reloj);
  }, [sinMovimiento]);

  // Deterministas a partir de la semilla: no hace falta aleatoriedad real y
  // asi el render del servidor y el del cliente coincidirian.
  const numeros = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const v = Math.sin((i + 1) * 1.7 + semilla * 0.6);
        return v.toFixed(2);
      }),
    [semilla],
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[0.75rem] text-suave">
      <span className="text-tenue">[</span>
      {numeros.map((n, i) => (
        <span key={i} className="tabular w-[3.1rem] text-center">
          {n}
        </span>
      ))}
      <span className="text-tenue">… ]</span>
      <span className="ms-1 text-tenue">1024 dim.</span>
    </div>
  );
}

/** Fragmentos con su score. Ejemplo de los pasos 3 y 4. */
function EjemploFragmentos({ ordenado }: { ordenado: boolean }) {
  // Reordenar es justo lo que hace el paso 4: la lista es la misma, el orden no.
  const filas = ordenado
    ? [...FRAGMENTOS_EJEMPLO].sort((a, b) => b.score - a.score)
    : FRAGMENTOS_EJEMPLO;

  return (
    <ul className="flex flex-col gap-2">
      {filas.map((fila) => (
        <m.li
          key={fila.documento}
          layout
          transition={{ duration: 0.3, ease: [0, 0, 0.2, 1] }}
          className="flex items-center gap-3 rounded-m border border-borde px-3 py-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[0.75rem]">
              {fila.documento}
            </span>
            <span className="block truncate text-[0.8125rem] text-suave">
              {fila.texto}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span
              className="h-1 w-16 overflow-hidden rounded-full bg-superficie-suave"
              aria-hidden="true"
            >
              <m.span
                className="block h-full rounded-full bg-texto"
                initial={{ width: 0 }}
                animate={{ width: `${fila.score * 100}%` }}
                transition={{ duration: 0.5, ease: [0, 0, 0.2, 1] }}
              />
            </span>
            <span className="tabular w-9 text-end font-mono text-[0.75rem] text-suave">
              {fila.score.toFixed(2)}
            </span>
          </span>
        </m.li>
      ))}
    </ul>
  );
}

function EjemploDe({ cual }: { cual: Paso['ejemplo'] }) {
  if (cual === 'consulta') {
    return (
      <ul className="flex flex-col gap-1.5 font-mono text-[0.8125rem] text-suave">
        <li className="text-texto">«{DEMO_PREGUNTA}»</li>
        <li className="ps-4">↳ garantías del teorema CAP</li>
        <li className="ps-4">↳ comportamiento ante particiones de red</li>
      </ul>
    );
  }
  if (cual === 'vector') return <EjemploVector />;
  if (cual === 'fragmentos') return <EjemploFragmentos ordenado={false} />;
  if (cual === 'reordenado') return <EjemploFragmentos ordenado />;
  return (
    <p className="text-[0.9375rem] text-suave">
      Un sistema distribuido no puede garantizar las tres a la vez{' '}
      <span className="inline-grid size-[1.15rem] place-items-center rounded-full border border-borde-fuerte align-text-bottom font-mono text-[0.625rem] text-texto">
        1
      </span>
      .
    </p>
  );
}

function Pipeline() {
  const sinMovimiento = useReducedMotion();
  // Clic y hover abren lo mismo. El clic manda: si el usuario fijo un paso, el
  // raton pasando por encima no se lo cambia.
  const [fijado, setFijado] = useState<string | null>(null);
  const [apuntado, setApuntado] = useState<string | null>(null);
  const abierto = fijado ?? apuntado;

  return (
    <section
      id="como-responde"
      className="mx-auto max-w-[1200px] border-t border-borde px-4 py-16 sm:px-6 sm:py-20"
    >
      <m.div {...REVELAR} className="flex flex-col gap-3">
        <p className="text-[0.875rem] font-medium text-suave">Cómo responde</p>
        <h2 className="max-w-[24ch] text-[clamp(1.5rem,1.1rem+1.4vw,1.75rem)] font-semibold tracking-[-0.02em]">
          De tu pregunta a una respuesta que puedes comprobar.
        </h2>
        <p className="max-w-[60ch] text-suave">
          Cinco pasos, y ninguno es una caja negra. Pulsa cualquiera para ver qué hace con
          un ejemplo real.
        </p>
      </m.div>

      {/*
        El pulso que recorre la linea NO es decoracion: representa la pregunta
        avanzando por el sistema. Por eso es lo unico que se anima en bucle en
        toda la pagina, y por eso se apaga con `prefers-reduced-motion`.
      */}
      <div className="relative mt-10">
        {/*
          Dos conectores y no uno con clases responsive: el pulso tiene que
          animar `top` en el vertical y `left` en el horizontal, y una sola
          pieza no puede hacer las dos cosas. Con un solo elemento el pulso se
          movia en movil y se quedaba quieto en escritorio.
        */}
        <div
          className="absolute start-[1.375rem] top-0 bottom-0 w-px bg-borde md:hidden"
          aria-hidden="true"
        >
          {!sinMovimiento ? (
            <m.span
              className="absolute -start-[2.5px] size-1.5 rounded-full bg-texto"
              animate={{ top: ['0%', '100%'] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'linear' }}
            />
          ) : null}
        </div>
        <div
          className="absolute top-[1.375rem] hidden h-px w-full bg-borde md:block"
          aria-hidden="true"
        >
          {!sinMovimiento ? (
            <m.span
              className="absolute -top-[2.5px] size-1.5 rounded-full bg-texto"
              animate={{ left: ['0%', '100%'] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'linear' }}
            />
          ) : null}
        </div>

        <ol className="relative flex flex-col gap-3 md:grid md:grid-cols-5 md:gap-4">
          {PASOS.map((paso, indice) => {
            const Icono = paso.icono;
            const estaAbierto = abierto === paso.id;

            return (
              <m.li
                key={paso.id}
                {...REVELAR}
                transition={{ ...REVELAR.transition, delay: indice * 0.07 }}
                className="min-w-0"
                onMouseEnter={() => setApuntado(paso.id)}
                onMouseLeave={() => setApuntado(null)}
              >
                <button
                  type="button"
                  aria-expanded={estaAbierto}
                  aria-controls={`detalle-${paso.id}`}
                  onClick={() => setFijado((f) => (f === paso.id ? null : paso.id))}
                  className={`flex w-full items-center gap-3 rounded-m py-1 text-start transition-colors md:flex-col md:items-start md:gap-2 ${FOCO}`}
                >
                  <span
                    className={`grid size-11 shrink-0 place-items-center rounded-full border bg-fondo transition-colors ${
                      estaAbierto ? 'border-texto text-texto' : 'border-borde text-tenue'
                    }`}
                  >
                    <Icono size={18} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] text-tenue">
                      Paso {indice + 1}
                    </span>
                    <span className="block text-[0.9375rem] font-medium">
                      {paso.titulo}
                    </span>
                  </span>
                </button>
              </m.li>
            );
          })}
        </ol>

        {/* El detalle va FUERA de la rejilla: dentro, abrirlo cambiaria el alto
            de una columna y descolocaria los otros cuatro nodos. */}
        <AnimatePresence initial={false} mode="wait">
          {abierto ? (
            <m.div
              key={abierto}
              id={`detalle-${abierto}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
              className="mt-6 flex flex-col gap-4 rounded-m border border-borde p-5 md:flex-row md:items-start md:gap-10"
            >
              <p className="max-w-[46ch] flex-1 text-[0.9375rem] text-suave">
                {PASOS.find((p) => p.id === abierto)?.explicacion}
              </p>
              <div className="min-w-0 flex-1">
                <EjemploDe cual={PASOS.find((p) => p.id === abierto)!.ejemplo} />
              </div>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  );
}

/* ============================================================================
 * DEMO SIMULADA
 * ==========================================================================*/

/** Una cita dentro de la respuesta de la demo. */
function CitaDemo({ numero }: { numero: number }) {
  const fuente = DEMO_FUENTES[numero - 1];
  if (!fuente) return <span>[{numero}]</span>;

  return (
    <span className="group/cita relative inline-block">
      <button
        type="button"
        aria-label={`Ver la fuente ${numero}: ${fuente.nombre}`}
        className={`mx-0.5 inline-grid h-[1.15rem] min-w-[1.15rem] place-items-center rounded-full border border-borde-fuerte px-1.5 align-text-bottom font-mono text-[0.625rem] text-texto transition-colors hover:bg-acento hover:text-sobre-acento ${FOCO}`}
      >
        {numero}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-[calc(100%+0.5rem)] start-1/2 z-20 flex w-max max-w-[20rem] -translate-x-1/2 flex-col gap-1 rounded-m border border-borde bg-superficie p-3 text-start opacity-0 shadow-[rgba(0,0,0,0.02)_0_4px_6px,rgba(0,0,0,0.05)_0_0_2px] transition-[opacity,visibility] duration-150 group-hover/cita:visible group-hover/cita:opacity-100 group-focus-within/cita:visible group-focus-within/cita:opacity-100"
      >
        <span className="font-mono text-[0.75rem] font-medium">{fuente.nombre}</span>
        <span className="text-[0.6875rem] text-tenue">{fuente.detalle}</span>
        <span className="mt-1 border-s-2 border-borde-fuerte ps-2 text-[0.8125rem] leading-relaxed text-suave">
          {fuente.texto}
        </span>
      </span>
    </span>
  );
}

/** Un `[3]` dentro del texto, con el numero capturado aparte. */
const CITA = /(\[\d+\])/;

/**
 * Parte el texto en tokens para revelarlo poco a poco.
 *
 * Primero por las CITAS y despues en palabras, en ese orden. Al reves, un
 * `[1].` con el punto pegado se queda en un solo token y deja de reconocerse
 * como cita: se pinta como texto plano y el popover no existe.
 */
function useTokens(texto: string) {
  return useMemo(
    () =>
      texto
        .split(CITA)
        .flatMap((trozo) => (CITA.test(trozo) ? [trozo] : trozo.split(/(\s+)/)))
        .filter(Boolean),
    [texto],
  );
}

function Demo() {
  const sinMovimiento = useReducedMotion();
  const referencia = useRef<HTMLDivElement>(null);
  const visible = useInView(referencia, { once: true, margin: '-80px' });
  const tokens = useTokens(DEMO_RESPUESTA);
  const [cuantos, setCuantos] = useState(0);

  useEffect(() => {
    // Igual que en Contador: con movimiento reducido el estado final se
    // deriva, no se escribe desde el efecto.
    if (!visible || sinMovimiento) return;

    let n = 0;
    const reloj = setInterval(() => {
      n += 1;
      setCuantos(n);
      if (n >= tokens.length) clearInterval(reloj);
    }, MS_POR_TOKEN);
    return () => clearInterval(reloj);
  }, [visible, sinMovimiento, tokens.length]);

  const mostrados = sinMovimiento ? tokens.length : cuantos;
  const escribiendo = mostrados < tokens.length;

  return (
    <section
      id="demo"
      className="mx-auto max-w-[1200px] border-t border-borde px-4 py-16 sm:px-6 sm:py-20"
      ref={referencia}
    >
      <m.div {...REVELAR} className="flex flex-col gap-3">
        <p className="text-[0.875rem] font-medium text-suave">Una respuesta de verdad</p>
        <h2 className="max-w-[24ch] text-[clamp(1.5rem,1.1rem+1.4vw,1.75rem)] font-semibold tracking-[-0.02em]">
          Cada afirmación lleva su fuente al lado.
        </h2>
      </m.div>

      <m.div
        {...REVELAR}
        transition={{ ...REVELAR.transition, delay: 0.08 }}
        className="mt-8 overflow-hidden rounded-m border border-borde"
      >
        <div className="flex justify-end border-b border-borde p-5">
          <p className="max-w-[80%] rounded-l bg-superficie-suave px-4 py-2.5">
            {DEMO_PREGUNTA}
          </p>
        </div>

        <div className="p-5">
          <p className="max-w-[62ch] leading-[1.65]" aria-live="off">
            {tokens.slice(0, mostrados).map((token, i) => {
              const cita = /^\[(\d+)\]$/.exec(token);
              if (cita) return <CitaDemo key={i} numero={Number(cita[1])} />;
              return <span key={i}>{token}</span>;
            })}
            {escribiendo ? (
              <span
                className="ms-0.5 inline-block h-[1.05em] w-[0.5rem] translate-y-[0.15em] bg-texto"
                aria-hidden="true"
              />
            ) : null}
          </p>

          {/* El texto completo, siempre, para quien use lector de pantalla: el
              revelado token a token es un efecto visual y no debe convertir la
              respuesta en algo que se lee a trozos. */}
          <span className="solo-lectores">{DEMO_RESPUESTA}</span>
        </div>
      </m.div>
    </section>
  );
}

/* ============================================================================
 * REJILLA EDITORIAL 65 / 35
 * ==========================================================================*/

function Coleccion() {
  return (
    <section id="coleccion" className="border-t border-borde py-16 sm:py-20">
      <div className="grid gap-4 md:grid-cols-[65fr_35fr]">
        <Revelar className="flex">
          <article className="flex flex-1 flex-col gap-6 rounded-m border border-borde p-6 sm:p-8">
            <div className="flex flex-col gap-3">
              <h2 className="text-[clamp(1.375rem,1.1rem+1vw,1.5rem)] font-medium tracking-[-0.02em]">
                {QUE_PREGUNTAR.titulo}
              </h2>
              <p className="max-w-[52ch] text-suave">{QUE_PREGUNTAR.entradilla}</p>
            </div>

            <ul className="flex flex-col">
              {QUE_PREGUNTAR.ejemplos.map((ejemplo, indice) => (
                <li
                  key={ejemplo.tipo}
                  className={`flex flex-col gap-1 py-4 sm:flex-row sm:gap-8 ${
                    indice > 0 ? 'border-t border-borde' : ''
                  }`}
                >
                  <span className="w-32 shrink-0 text-[0.875rem] font-medium">
                    {ejemplo.tipo}
                  </span>
                  <span className="text-[0.9375rem] text-suave">{ejemplo.texto}</span>
                </li>
              ))}
            </ul>
          </article>
        </Revelar>

        <div className="flex flex-col gap-4">
          {METRICAS.map((metrica, indice) => (
            <Revelar key={metrica.etiqueta} indice={indice + 1} className="flex">
              <article className="flex flex-1 flex-col justify-center gap-1 rounded-m border border-borde p-6">
                <p className="text-[clamp(1.75rem,1.4rem+1.4vw,2rem)] leading-none font-medium tracking-[-0.02em]">
                  <Contador hasta={metrica.valor} sufijo={metrica.sufijo} />
                </p>
                <p className="text-[0.875rem] text-suave">{metrica.etiqueta}</p>
              </article>
            </Revelar>
          ))}

          <Revelar indice={4}>
            <article className="flex flex-col gap-1 rounded-m border border-borde p-6">
              <p className="text-[0.9375rem] font-medium">{ULTIMA_ACTUALIZACION}</p>
              <p className="text-[0.875rem] text-suave">Última indexación</p>
            </article>
          </Revelar>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
 * EL RECORRIDO DEL SITIO
 * ==========================================================================*/

/**
 * La rejilla que lleva al resto del sitio: la primera seccion a lo grande y el
 * resto en una columna de tarjetas pequeñas.
 *
 * Sale de SECCIONES, que es tambien de donde salen la barra y el bloque
 * "Siguiente" de cada pagina: una sola lista para las tres cosas, para que no
 * se desincronicen.
 */
function Recorrido() {
  // La portada no se enlaza a si misma.
  const [primera, ...resto] = RUTAS_NAV.filter((r) => r.id !== 'home');
  if (!primera) return null;

  return (
    <section className="border-t border-borde py-16 sm:py-20">
      <Revelar>
        <p className="mb-8 text-[0.875rem] font-medium text-suave">
          Todo lo que hay por dentro
        </p>
      </Revelar>

      <div className="grid gap-x-4 gap-y-10 md:grid-cols-[65fr_35fr]">
        <Revelar>
          <ArticleCard
            size="lg"
            eyebrow={primera.eyebrow!}
            titulo={primera.titulo!}
            entradilla={primera.entradilla!}
            href={primera.path}
            paleta={primera.paleta!}
            forma={primera.forma}
          />
        </Revelar>

        <div className="flex flex-col gap-10">
          {resto.slice(0, 3).map((seccion, indice) => (
            <Revelar key={seccion.id} indice={indice + 1}>
              <ArticleCard
                eyebrow={seccion.eyebrow!}
                titulo={seccion.titulo!}
                entradilla={seccion.entradilla!}
                href={seccion.path}
                paleta={seccion.paleta!}
                forma={seccion.forma}
              />
            </Revelar>
          ))}
        </div>
      </div>

      {/* La fila de abajo solo existe si hay secciones de sobra. Pintarla
          vacia dejaria un margen de 40px sin nada debajo. */}
      {resto.length > 3 ? (
        <div className="mt-10 grid gap-x-4 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {resto.slice(3).map((seccion, indice) => (
            <Revelar key={seccion.id} indice={indice}>
              <ArticleCard
                eyebrow={seccion.eyebrow!}
                titulo={seccion.titulo!}
                entradilla={seccion.entradilla!}
                href={seccion.path}
                paleta={seccion.paleta!}
                forma={seccion.forma}
              />
            </Revelar>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ============================================================================
 * LA PAGINA
 * ==========================================================================*/

/**
 * Portada del sitio.
 *
 * Todo el movimiento de aqui representa algo que el sistema hace de verdad —el
 * pulso que recorre el pipeline es la pregunta avanzando, el revelado token a
 * token es el streaming real, los contadores son el tamaño del indice— y por
 * eso sobrevive a `prefers-reduced-motion` en su estado final en vez de
 * desaparecer.
 */
export function Inicio() {
  return (
    <>
      <Hero />
      <Pipeline />
      <Demo />
      <Coleccion />
      <Recorrido />
      <AnteriorSiguiente id="home" />
    </>
  );
}

export default Inicio;
