import {
  useCallback,
  useImperativeHandle,
  useState,
  type ReactNode,
  type Ref,
} from 'react';

// `motion/react-m` da los componentes sin la fabrica completa de `motion.*`,
// que es lo que de verdad recorta el bundle (medido: 124 -> 110,7 kB gz).
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { ArrowLeft, Library, PanelLeft, PanelRight } from 'lucide-react';

import { CONSULTA_ESCRITORIO, useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { leerUltimaPagina } from '@/shared/lib/ultimaPagina';
import { IconButton } from '@/shared/ui/IconButton';
import { Sello } from '@/shared/ui/Logo';
import { Drawer } from '@/shared/ui/Drawer';

type Props = {
  /** Conversaciones. Los documentos van por su cuenta, en `documentos`. */
  lateral: ReactNode;
  children: ReactNode;
  fuentes: ReactNode;
  /** Gestion de documentos: siempre en un panel, nunca en la columna. */
  documentos: ReactNode;
  /** Que se esta mirando: el titulo del hilo abierto, o el nombre de la
   *  aplicacion cuando no hay ninguno. */
  titulo: ReactNode;
  /** El indicador de estado que va en la barra. */
  indicador: ReactNode;
  /** Botones extra de la cabecera, a la derecha del indicador. */
  acciones: ReactNode;
  ref?: Ref<ControlesShell>;
};

/** Lo que se le puede pedir al shell desde fuera. */
export type ControlesShell = {
  /** En escritorio despliega la columna; en compacto abre el panel. */
  abrirFuentes: () => void;
  /** Abre conversaciones. En escritorio las despliega si estaban plegadas. */
  abrirLateral: () => void;
  /** Abre la gestion de documentos, que siempre es un panel. */
  abrirDocumentos: () => void;
};

/** La columna lateral se anima por ancho, asi que necesita un numero. */
const ANCHO_LATERAL = 264;
const ANCHO_FUENTES = 340;

/**
 * Las tres zonas del producto: conversaciones a un lado, el chat en el centro
 * y las fuentes al otro.
 *
 * El contenido llega por props en vez de importarse aqui: asi el shell no sabe
 * nada del dominio y se puede mirar y probar solo.
 *
 * En escritorio son columnas; por debajo de 1024px pasan a ser `<dialog>`
 * modales. El mismo contenido se pinta en los dos sitios, pero el arbol es
 * distinto a proposito: un panel de columna y un modal no se comportan igual
 * (foco, Escape, inerte) y fingir que si lleva a paneles inaccesibles.
 */
export function AppShell({
  lateral,
  children,
  fuentes,
  documentos,
  titulo,
  indicador,
  acciones,
  ref,
}: Props) {
  const esEscritorio = useMediaQuery(CONSULTA_ESCRITORIO);
  const [lateralAbierto, setLateralAbierto] = useState(false);
  const [fuentesAbiertas, setFuentesAbiertas] = useState(false);
  const [documentosAbiertos, setDocumentosAbiertos] = useState(false);
  const [lateralVisible, setLateralVisible] = useState(true);
  const [fuentesVisibles, setFuentesVisibles] = useState(true);

  // Abrir un panel es una accion puntual, no un estado que haya que
  // sincronizar: se expone como metodo en vez de como prop. Con una prop
  // habria que mirarla desde un efecto, que es justo el render en cascada que
  // `react/set-state-in-effect` desaconseja.
  useImperativeHandle(
    ref,
    () => ({
      abrirFuentes: () => {
        if (esEscritorio) setFuentesVisibles(true);
        else setFuentesAbiertas(true);
      },
      abrirLateral: () => {
        if (esEscritorio) setLateralVisible(true);
        else setLateralAbierto(true);
      },
      abrirDocumentos: () => setDocumentosAbiertos(true),
    }),
    [esEscritorio],
  );

  // Estables: son dependencias del efecto que escucha el 'close' del dialogo.
  const cerrarLateral = useCallback(() => setLateralAbierto(false), []);
  const cerrarFuentes = useCallback(() => setFuentesAbiertas(false), []);
  const cerrarDocumentos = useCallback(() => setDocumentosAbiertos(false), []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/*
        Primera parada de tabulacion. Sin esto hay que atravesar el historial
        entero para llegar al campo de escribir, que es lo que se viene a
        hacer. Solo se ven al recibir el foco.
      */}
      <nav className="absolute z-20" aria-label="Saltar a">
        <a
          href="#chat"
          className="absolute -top-40 start-2 whitespace-nowrap rounded-full border border-texto bg-superficie px-5 py-2.5 text-sm font-medium text-texto transition-[top] focus:top-3"
        >
          Saltar al chat
        </a>
        <a
          href="#lateral"
          className="absolute -top-40 start-2 whitespace-nowrap rounded-full border border-texto bg-superficie px-5 py-2.5 text-sm font-medium text-texto transition-[top] focus:top-3 focus:start-44"
        >
          Saltar a conversaciones
        </a>
      </nav>

      {/* Cabecera fina: 48px. Translucida, para que la aurora se intuya por
          detras y deje de ser una barra opaca pegada encima. */}
      {/*
        Es una TOOLBAR, no una cabecera de pagina web.
        La version anterior era logo-a-la-izquierda / iconos-a-la-derecha, que
        es el patron de una web de marketing, no de una aplicacion. Aqui:

          - Los dos interruptores de panel hacen de topes de la barra, cada uno
            del lado del panel que controla. Se entiende sin leer nada.
          - En medio va el contexto: que conversacion se esta mirando. Es lo
            que convierte una barra de botones en una barra de herramientas.
          - Las acciones se agrupan a la derecha, separadas del estado.

        Sin `backdrop-blur`: el contenido tiene su propio scroll y no pasa por
        debajo, asi que el desenfoque costaba una capa de composicion para no
        verse nunca.
      */}
      <header className="relative z-10 flex h-16 shrink-0 items-center gap-1 bg-fondo px-3">
        {/*
          La salida hacia el sitio. La aplicacion era un callejon: una vez
          dentro no habia forma de volver mas que con el boton de atras del
          navegador o escribiendo la URL.

          `<a>` y no `<Link>`: /app vive fuera del router del sitio, y el
          sitio es otro arbol de React. Vuelve a donde estabas, no siempre a
          la portada: si entraste desde Arquitectura, mandarte a la portada te
          hace repetir el camino.
        */}
        <a
          href={leerUltimaPagina()}
          className="group flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-medium text-suave transition-colors hover:bg-superficie-suave hover:text-texto"
        >
          <ArrowLeft size={15} strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden sm:inline">Volver al sitio</span>
          <span className="sm:hidden">Sitio</span>
        </a>

        <span className="mx-1 h-4 w-px bg-borde" aria-hidden="true" />

        <IconButton
          etiqueta="Abrir conversaciones"
          icono={<PanelLeft size={18} />}
          onClick={() => setLateralAbierto(true)}
          className="lg:hidden"
        />

        {esEscritorio ? (
          <IconButton
            etiqueta={
              lateralVisible ? 'Plegar conversaciones' : 'Desplegar conversaciones'
            }
            icono={<PanelLeft size={18} />}
            aria-pressed={lateralVisible}
            onClick={() => setLateralVisible((v) => !v)}
          />
        ) : null}

        {/*
          El titulo se trunca y los botones no se encogen: con un titulo largo
          lo que debe ceder es el texto.

          Por debajo de `sm` se esconde entero y el hueco queda de separador.
          A 390px no caben siete controles y un titulo, y el titulo es lo
          prescindible: la conversacion esta justo debajo, en pantalla.
        */}
        <div className="mx-2 flex min-w-0 flex-1 items-center gap-2">
          <Sello tamano={18} className="hidden shrink-0 text-tenue sm:block" />
          <span className="hidden truncate text-[0.875rem] font-medium tracking-[-0.01em] sm:block">
            {titulo}
          </span>
        </div>

        {indicador}

        <span className="mx-2 h-5 w-px bg-borde" aria-hidden="true" />

        <IconButton
          etiqueta="Documentos indexados"
          // `Library` y no `FileText`: el simbolo de la marca ya es una hoja
          // con renglones y los dos iconos se confundian en la misma barra.
          icono={<Library size={18} />}
          onClick={() => setDocumentosAbiertos(true)}
        />
        {acciones}

        <span className="mx-2 h-5 w-px bg-borde" aria-hidden="true" />

        <IconButton
          // En escritorio es un interruptor del panel; en movil abre un modal.
          // El nombre accesible debe decir lo que hace en cada caso, y
          // `aria-pressed` solo tiene sentido en el interruptor.
          etiqueta={
            esEscritorio
              ? fuentesVisibles
                ? 'Plegar el panel de fuentes'
                : 'Desplegar el panel de fuentes'
              : 'Abrir el panel de fuentes'
          }
          icono={<PanelRight size={18} />}
          aria-pressed={esEscritorio ? fuentesVisibles : undefined}
          onClick={() =>
            esEscritorio ? setFuentesVisibles((v) => !v) : setFuentesAbiertas(true)
          }
        />
      </header>

      <div className="flex min-h-0 flex-1">
        {/*
          El chat va PRIMERO en el DOM aunque se vea en el centro: el orden de
          tabulacion sigue al documento, y lo primero que quiere hacer alguien
          es escribir, no recorrer el historial. `order` lo coloca en su sitio.
        */}
        <main
          className="order-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          id="chat"
          aria-label="Conversación"
        >
          {children}
        </main>

        {/* AnimatePresence para que plegar tambien se vea: sin el, el panel
            desaparece de golpe y parece que se ha roto algo. */}
        <AnimatePresence initial={false}>
          {esEscritorio && lateralVisible ? (
            <m.aside
              key="lateral"
              id="lateral"
              aria-label="Conversaciones"
              className="order-1 min-h-0 shrink-0 overflow-hidden border-e border-borde"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: ANCHO_LATERAL, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.26, ease: [0.2, 0.9, 0.2, 1] }}
            >
              <div className="h-full overflow-y-auto" style={{ width: ANCHO_LATERAL }}>
                {lateral}
              </div>
            </m.aside>
          ) : null}

          {esEscritorio && fuentesVisibles ? (
            <m.aside
              key="fuentes"
              aria-label="Fuentes de la respuesta"
              className="order-3 min-h-0 shrink-0 overflow-hidden border-s border-borde"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: ANCHO_FUENTES, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.26, ease: [0.2, 0.9, 0.2, 1] }}
            >
              <div className="h-full overflow-y-auto" style={{ width: ANCHO_FUENTES }}>
                {fuentes}
              </div>
            </m.aside>
          ) : null}
        </AnimatePresence>
      </div>

      {!esEscritorio ? (
        <>
          <Drawer
            abierto={lateralAbierto}
            alCerrar={cerrarLateral}
            titulo="Conversaciones"
            lado="inicio"
          >
            {lateral}
          </Drawer>
          {/* Hoja inferior y no panel lateral: las fuentes se consultan con el
              pulgar mientras se lee la respuesta. */}
          <Drawer
            abierto={fuentesAbiertas}
            alCerrar={cerrarFuentes}
            titulo="Fuentes de la respuesta"
            lado="abajo"
          >
            {fuentes}
          </Drawer>
        </>
      ) : null}

      {/* Los documentos son un panel en las dos medidas: indexar es una tarea
          aparte, no algo que se consulte mientras se conversa. Ocupaban media
          columna lateral para algo que se usa una vez al dia. */}
      <Drawer
        abierto={documentosAbiertos}
        alCerrar={cerrarDocumentos}
        titulo="Documentos"
        lado="fin"
      >
        {documentos}
      </Drawer>
    </div>
  );
}
