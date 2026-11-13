import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ArrowLeft, FileX, RotateCcw } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';

import {
  buscarSeccion,
  tituloLegible,
  trocearEnSecciones,
  type Seccion,
} from '@/features/visor/secciones';
import estilos from '@/features/visor/VisorDocumento.module.css';
import { obtenerContenidoDocumento } from '@/shared/api/documentos';
import { ErrorApi, mensajeDeError } from '@/shared/api/errores';
import type { ContenidoDocumento } from '@/shared/api/types';
import { markdownAHtml } from '@/shared/lib/markdown';
import { clases } from '@/shared/ui/clases';
import { Button, Skeleton } from '@/shared/ui';
import { PARAM_PAGINA, PARAM_SECCION, RUTA_APP } from '@/routes';

/**
 * Estado propio y no `useRecurso`: la pantalla tiene que distinguir "no
 * existe" (404) de "existe pero no tiene contenido guardado" (409), y
 * `useRecurso` solo guarda el mensaje.
 */
type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; mensaje: string; codigo: number | undefined }
  | { fase: 'listo'; contenido: ContenidoDocumento };

/** Cuanto antes de entrar en pantalla se convierte una seccion. */
const MARGEN_PREVIO = '200% 0px';

/** Las primeras secciones se pintan sin esperar al observador. */
const SECCIONES_INICIALES = 3;

/**
 * El contenido completo de un documento, tal como lo extrajo Docling.
 *
 * Se pinta por encima del chat (ver `App`), en su propia ruta. Desde una
 * fuente llega con `?pagina=` y `?seccion=`, y se abre situado en esa seccion.
 *
 * Un documento de cientos de paginas no se convierte de una vez: se parte en
 * secciones (`trocearEnSecciones`) y cada una pasa por marked + DOMPurify solo
 * cuando esta a punto de verse. Ademas `content-visibility: auto` hace que el
 * navegador no maquete ni pinte las que estan fuera de la vista.
 */
export default function VisorDocumento() {
  const { id: parametroId } = useParams();
  const [busqueda] = useSearchParams();
  const id = Number(parametroId);

  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    const control = new AbortController();
    obtenerContenidoDocumento(id, { signal: control.signal })
      .then((contenido) => setEstado({ fase: 'listo', contenido }))
      .catch((error: unknown) => {
        if (control.signal.aborted) return;
        setEstado({
          fase: 'error',
          mensaje: mensajeDeError(error),
          codigo: error instanceof ErrorApi ? error.estado : undefined,
        });
      });
    return () => control.abort();
  }, [id, intento]);

  const reintentar = useCallback(() => {
    setEstado({ fase: 'cargando' });
    setIntento((n) => n + 1);
  }, []);

  const titulo = useRef<HTMLHeadingElement>(null);
  // Al entrar, el foco va al titulo: quien usa lector de pantalla sabe que ha
  // cambiado de pantalla, y el chat de debajo queda inerte.
  useEffect(() => titulo.current?.focus(), []);

  const idValido = Number.isInteger(id) && id > 0;
  const nombre = estado.fase === 'listo' ? estado.contenido.documento.name : 'Documento';

  return (
    <div
      className="fixed inset-0 z-30 flex flex-col bg-fondo"
      role="region"
      aria-label={`Contenido de ${nombre}`}
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-borde px-3">
        <Link
          to={RUTA_APP}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.875rem] text-suave transition-colors hover:bg-superficie-suave hover:text-texto"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Volver al chat
        </Link>
        <h1
          ref={titulo}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] font-semibold text-texto focus:outline-none"
          title={estado.fase === 'listo' ? estado.contenido.documento.origin : undefined}
        >
          {nombre}
        </h1>
        {estado.fase === 'listo' && estado.contenido.paginas > 0 ? (
          <span className="tabular shrink-0 font-mono text-[0.75rem] text-tenue">
            {estado.contenido.paginas} pág.
          </span>
        ) : null}
      </header>

      {!idValido ? (
        <Aviso titulo="Ese documento no existe">
          La dirección no corresponde a ningún documento.
        </Aviso>
      ) : estado.fase === 'cargando' ? (
        <Cargando />
      ) : estado.fase === 'error' ? (
        <ErrorCarga estado={estado} reintentar={reintentar} />
      ) : (
        <Lectura
          // Otro destino es otra lectura: asi `pintadas` se inicializa con
          // la seccion nueva, en vez de corregirla desde un efecto.
          key={`${id}:${busqueda.get(PARAM_SECCION) ?? ''}:${busqueda.get(PARAM_PAGINA) ?? ''}`}
          contenido={estado.contenido}
          seccionBuscada={busqueda.get(PARAM_SECCION)}
          paginaBuscada={numeroOnull(busqueda.get(PARAM_PAGINA))}
        />
      )}
    </div>
  );
}

function numeroOnull(texto: string | null): number | null {
  const numero = Number(texto);
  return texto !== null && Number.isInteger(numero) && numero > 0 ? numero : null;
}

function Cargando() {
  return (
    <div
      className="mx-auto flex w-full max-w-lectura flex-col gap-3 px-4 py-10"
      aria-busy="true"
    >
      <Skeleton ancho="40%" alto="1.5rem" />
      <Skeleton />
      <Skeleton />
      <Skeleton ancho="80%" />
      <span className="solo-lectores">Cargando el documento</span>
    </div>
  );
}

function Aviso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div
      className="mx-auto flex max-w-[44ch] flex-col items-center gap-3 px-6 py-16 text-center"
      role="status"
    >
      <span
        className="grid size-12 place-items-center rounded-full border border-borde text-tenue"
        aria-hidden="true"
      >
        <FileX size={18} />
      </span>
      <p className="font-medium text-texto">{titulo}</p>
      <div className="text-[0.875rem] text-balance text-suave">{children}</div>
    </div>
  );
}

function ErrorCarga({
  estado,
  reintentar,
}: {
  estado: Extract<Estado, { fase: 'error' }>;
  reintentar: () => void;
}) {
  if (estado.codigo === 404) {
    return (
      <Aviso titulo="Ese documento ya no existe">
        Puede que se haya borrado. Vuelve al chat y elige otro desde la lista de
        documentos.
      </Aviso>
    );
  }
  if (estado.codigo === 409) {
    // El motivo exacto (en cola, en error, indexado antes de guardar el
    // contenido) lo da el backend.
    return (
      <Aviso titulo="Este documento no tiene su contenido guardado">
        <p>{estado.mensaje}</p>
        <p className="mt-2 text-tenue">
          Sus fragmentos pueden seguir usándose para responder; lo que falta es el texto
          completo para leerlo aquí.
        </p>
      </Aviso>
    );
  }
  return (
    <Aviso titulo="No se ha podido cargar el documento">
      <p>{estado.mensaje}</p>
      <Button variante="secundario" tamano="sm" onClick={reintentar} className="mt-3">
        <RotateCcw size={14} aria-hidden="true" />
        Reintentar
      </Button>
    </Aviso>
  );
}

function Lectura({
  contenido,
  seccionBuscada,
  paginaBuscada,
}: {
  contenido: ContenidoDocumento;
  seccionBuscada: string | null;
  paginaBuscada: number | null;
}) {
  const secciones = useMemo(
    () => trocearEnSecciones(contenido.markdown),
    [contenido.markdown],
  );
  const destino = useMemo(
    () =>
      seccionBuscada || paginaBuscada
        ? buscarSeccion(secciones, { seccion: seccionBuscada, pagina: paginaBuscada })
        : null,
    [secciones, seccionBuscada, paginaBuscada],
  );

  // Las secciones ya convertidas. Solo crece: volver a una que ya se vio no
  // la convierte otra vez, y su altura real ya la conoce el navegador.
  const [pintadas, setPintadas] = useState<Set<number>>(() => {
    const iniciales = new Set(
      secciones.slice(0, SECCIONES_INICIALES).map((s) => s.indice),
    );
    if (destino !== null) {
      for (const vecina of [destino - 1, destino, destino + 1]) iniciales.add(vecina);
    }
    return iniciales;
  });

  const pintar = useCallback((indices: number[]) => {
    setPintadas((actuales) => {
      if (indices.every((i) => actuales.has(i))) return actuales;
      const nuevas = new Set(actuales);
      for (const i of indices) nuevas.add(i);
      return nuevas;
    });
  }, []);

  const zona = useRef<HTMLDivElement>(null);
  const columna = useRef<HTMLElement>(null);

  // El ancho de la columna de lectura, para estimar la altura de lo que aun
  // no se ha pintado. null hasta la primera medida; se vuelve a medir si
  // cambia, al girar el movil o redimensionar la ventana.
  const [anchoColumna, setAnchoColumna] = useState<number | null>(null);
  useEffect(() => {
    const nodo = columna.current;
    if (!nodo) return;
    const observador = new ResizeObserver(([entrada]) => {
      if (entrada) setAnchoColumna(Math.round(entrada.contentRect.width));
    });
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  // Un solo observador para todas las secciones, con margen: se convierten un
  // poco antes de entrar, para que al llegar ya esten pintadas.
  useEffect(() => {
    const raiz = zona.current;
    if (!raiz) return;
    const observador = new IntersectionObserver(
      (entradas) => {
        const visibles = entradas
          .filter((e) => e.isIntersecting)
          .map((e) => Number((e.target as HTMLElement).dataset.seccion));
        if (visibles.length) pintar(visibles);
      },
      { root: raiz, rootMargin: MARGEN_PREVIO },
    );
    for (const nodo of raiz.querySelectorAll('[data-seccion]')) observador.observe(nodo);
    return () => observador.disconnect();
  }, [secciones, pintar]);

  // Al siguiente fotograma: la seccion tiene que estar ya en el DOM con su
  // contenido para que el scroll caiga en su sitio.
  const desplazarA = useCallback((indice: number) => {
    requestAnimationFrame(() => {
      zona.current
        ?.querySelector(`[data-seccion="${indice}"]`)
        ?.scrollIntoView({ block: 'start' });
    });
  }, []);

  const irA = useCallback(
    (indice: number) => {
      pintar([indice - 1, indice, indice + 1]);
      desplazarA(indice);
    },
    [pintar, desplazarA],
  );

  // Situarse en la seccion de la fuente al abrir, una sola vez. Solo desplaza:
  // la seccion y sus vecinas ya estan en el estado inicial de `pintadas`. Y
  // espera a tener medida la columna: si saltara antes, al medirla cambiarian
  // las alturas estimadas de todo lo de arriba y el destino se iria de la vista.
  const yaSituado = useRef(false);
  useEffect(() => {
    if (destino === null || anchoColumna === null || yaSituado.current) return;
    yaSituado.current = true;
    desplazarA(destino);
  }, [destino, anchoColumna, desplazarA]);

  const indice = useMemo(
    () => secciones.filter((s) => s.nivel >= 1 && s.nivel <= 3),
    [secciones],
  );

  if (secciones.length === 0) {
    return (
      <Aviso titulo="El documento está vacío">
        Docling no extrajo ningún texto de este documento.
      </Aviso>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {indice.length > 1 ? (
        <nav
          aria-label="Índice del documento"
          className="hidden w-64 shrink-0 overflow-y-auto border-e border-borde p-3 lg:block"
        >
          <h2 className="etiqueta-seccion px-2 pb-2">Índice</h2>
          <ol className="flex flex-col gap-px">
            {indice.map((seccion) => (
              <li key={seccion.indice}>
                <button
                  type="button"
                  onClick={() => irA(seccion.indice)}
                  aria-current={seccion.indice === destino ? 'location' : undefined}
                  className="w-full truncate rounded-s px-2 py-1 text-start text-[0.8125rem] text-suave transition-colors hover:bg-superficie-hover hover:text-texto aria-[current]:font-medium aria-[current]:text-texto"
                  style={{ paddingInlineStart: `${0.5 + (seccion.nivel - 1) * 0.75}rem` }}
                  title={tituloLegible(seccion.titulo)}
                >
                  {tituloLegible(seccion.titulo)}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div ref={zona} className="min-w-0 flex-1 overflow-y-auto" data-zona-lectura="">
        <article
          ref={columna}
          className="mx-auto flex w-full max-w-lectura flex-col gap-6 px-4 py-8"
        >
          {secciones.map((seccion) => (
            <BloqueSeccion
              key={seccion.indice}
              seccion={seccion}
              pintada={pintadas.has(seccion.indice)}
              esDestino={seccion.indice === destino}
              paginaBuscada={paginaBuscada}
              anchoColumna={anchoColumna ?? ANCHO_LECTURA}
            />
          ))}
        </article>
      </div>
    </div>
  );
}

/** Alto de una linea de prosa (1rem con interlineado 1.6) y ancho medio de
 *  un caracter, en px. Aproximados: solo sirven para estimar. */
const ALTO_LINEA = 26;
const ANCHO_CARACTER = 8;
/** La columna de lectura en escritorio (70ch), hasta que se mide la de verdad. */
const ANCHO_LECTURA = 640;

/**
 * La altura que se reserva para una seccion mientras no se ha pintado.
 *
 * Con una altura fija, saltar al final de un documento largo no llega al
 * final: las secciones que se pintan al llegar crecen mas que lo reservado y
 * el final se aleja. Estimarla por la longitud del texto y el ancho real de la
 * columna (en un movil caben la mitad de caracteres por linea) deja la barra
 * de scroll y los saltos cerca de su sitio. Una vez pintada, `auto` hace que
 * el navegador recuerde la altura real.
 */
function alturaEstimada(markdown: string, anchoColumna: number): number {
  const porLinea = Math.max(20, Math.floor(anchoColumna / ANCHO_CARACTER));
  const lineas = markdown
    .split('\n')
    .reduce((total, linea) => total + Math.max(1, Math.ceil(linea.length / porLinea)), 0);
  return Math.max(48, lineas * ALTO_LINEA);
}

function BloqueSeccion({
  seccion,
  pintada,
  esDestino,
  paginaBuscada,
  anchoColumna,
}: {
  seccion: Seccion;
  pintada: boolean;
  esDestino: boolean;
  paginaBuscada: number | null;
  anchoColumna: number;
}) {
  // El Markdown es de un documento de terceros: solo entra en el DOM despues
  // de pasar por markdownAHtml, que lo sanea con una lista blanca.
  const html = useMemo(
    () => (pintada ? markdownAHtml(seccion.markdown) : ''),
    [pintada, seccion.markdown],
  );

  return (
    <section
      data-seccion={seccion.indice}
      data-pintada={pintada ? '' : undefined}
      aria-current={esDestino ? 'location' : undefined}
      className={clases(estilos.seccion, esDestino && estilos.destino)}
      style={{
        containIntrinsicSize: `auto ${alturaEstimada(seccion.markdown, anchoColumna)}px`,
      }}
    >
      {esDestino ? (
        <p className="etiqueta-seccion mb-2">
          De aquí sale la fuente
          {paginaBuscada ? (
            <span className="tabular font-mono"> · pág. {paginaBuscada}</span>
          ) : null}
        </p>
      ) : null}
      {pintada ? (
        <div className={estilos.contenido} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        // Mientras no se pinta, el titulo si: el indice y el salto lo
        // necesitan, y es texto plano, sin HTML.
        <p className="font-medium text-tenue">{tituloLegible(seccion.titulo)}</p>
      )}
    </section>
  );
}
