import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';

import { repartir } from '@/features/documentos/ingesta';
import type { Ingesta } from '@/features/documentos/useIngesta';
import { EXTENSIONES, extensionAdmitida, TAMANO_MAXIMO } from '@/shared/api/documentos';
import { Badge, Button, IconButton, Input, Spinner } from '@/shared/ui';
import { clases } from '@/shared/ui/clases';

const ICONO_QUITAR = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
    <path
      d="m6 6 12 12M18 6 6 18"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

type Modo = 'url' | 'fichero';

/** «1 fichero» / «3 ficheros». Repetir esto en cada mensaje se nota al leerlo. */
function plural(n: number): string {
  return `${n} ${n === 1 ? 'fichero' : 'ficheros'}`;
}

export function FormularioIngesta({ ingesta }: { ingesta: Ingesta }) {
  const [modo, setModo] = useState<Modo>('url');
  const [valor, setValor] = useState('');
  const [arrastrando, setArrastrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const selector = useRef<HTMLInputElement>(null);
  const idModos = useId();
  const idCupo = useId();
  const lleno = ingesta.huecos === 0;

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!valor.trim()) return;
    ingesta.indexar(valor, modo === 'url' ? 'url' : 'fichero');
    setValor('');
  }

  /**
   * Decide qué se manda y, si algo se queda fuera, lo dice.
   *
   * Tres filtros en orden: extensión, tamaño y cupo. El del cupo va último
   * porque es el único que no depende del fichero sino del momento: el mismo
   * fichero cabe ahora y no cabe dentro de un segundo.
   *
   * Se trunca aquí, antes de subir nada. Mandarlo todo y dejar que el servidor
   * conteste 429 significa subir cuerpos completos por la red para nada, y
   * dejar al usuario mirando varios errores sin entender por qué justo esos.
   */
  function admitir(ficheros: File[]): File[] {
    const malos = ficheros.filter((f) => !extensionAdmitida(f.name));
    const gordos = ficheros.filter((f) => f.size > TAMANO_MAXIMO);
    const validos = ficheros.filter(
      (f) => extensionAdmitida(f.name) && f.size <= TAMANO_MAXIMO,
    );
    const { caben, sobran } = repartir(validos, ingesta.huecos);

    if (malos.length > 0) {
      setAviso(
        `No se puede indexar «${malos[0]!.name}». Admitidos: ${EXTENSIONES.join(', ')}.`,
      );
    } else if (gordos.length > 0) {
      setAviso(`«${gordos[0]!.name}» pasa de 50 MB, el máximo por fichero.`);
    } else if (sobran.length === 0) {
      setAviso(null);
    } else if (caben.length === 0) {
      setAviso(
        `El servidor procesa ${ingesta.maxEnVuelo} a la vez como máximo, y ya están ` +
          `los ${ingesta.maxEnVuelo}. Espera a que acabe alguna.`,
      );
    } else {
      setAviso(
        `Solo caben ${caben.length} más. Se han añadido ${plural(caben.length)} y ` +
          `se ${sobran.length === 1 ? 'ha' : 'han'} dejado fuera ${plural(sobran.length)}: ` +
          `${sobran.map((f) => f.name).join(', ')}.`,
      );
    }

    return caben;
  }

  function alSoltar(evento: DragEvent) {
    evento.preventDefault();
    setArrastrando(false);
    // Un <button disabled> no dispara click, pero sí puede recibir un drop, así
    // que el cupo se vuelve a comprobar aquí.
    const buenos = admitir([...evento.dataTransfer.files]);
    if (buenos.length > 0) ingesta.subir(buenos);
  }

  function alElegir(evento: ChangeEvent<HTMLInputElement>) {
    const buenos = admitir([...(evento.target.files ?? [])]);
    if (buenos.length > 0) ingesta.subir(buenos);
    // Se limpia para que elegir el mismo fichero otra vez vuelva a disparar.
    evento.target.value = '';
  }

  return (
    <form className={'flex flex-col gap-3'} onSubmit={enviar}>
      <div
        className={'flex gap-1 rounded-m border border-borde p-1'}
        role="tablist"
        aria-label="Qué quieres indexar"
      >
        {(['url', 'fichero'] as const).map((opcion) => (
          <button
            key={opcion}
            type="button"
            role="tab"
            id={`${idModos}-${opcion}`}
            aria-selected={modo === opcion}
            className={
              'flex-1 rounded-s px-2 py-1.5 text-[0.8125rem] text-suave transition-colors hover:bg-superficie-hover aria-selected:bg-acento-suave aria-selected:font-medium aria-selected:text-acento'
            }
            onClick={() => {
              setModo(opcion);
              setAviso(null);
            }}
          >
            {opcion === 'url' ? 'Página web' : 'Fichero'}
          </button>
        ))}
      </div>

      {modo === 'url' ? (
        <Input
          etiqueta="URL de la página"
          etiquetaOculta
          type="url"
          placeholder="https://ejemplo.com/manual"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      ) : (
        <>
          {/* La zona entera es un botón: así se puede soltar con el ratón y
              también abrir el selector con Enter o Espacio desde el teclado. */}
          <button
            type="button"
            disabled={lleno}
            aria-describedby={idCupo}
            className={clases(
              'flex flex-col items-center gap-1.5 rounded-m border border-dashed border-borde-fuerte px-4 py-8 text-center transition-colors',
              arrastrando && 'border-acento bg-acento-suave',
              lleno && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => selector.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={alSoltar}
          >
            <span className={'text-sm font-medium text-texto'}>
              {lleno ? 'No caben más por ahora' : 'Suelta tus ficheros aquí'}
            </span>
            <span>
              {lleno
                ? 'Espera a que acaben las que están en marcha'
                : `o pulsa para elegirlos · ${EXTENSIONES.join(', ')}`}
            </span>
          </button>
          <input
            ref={selector}
            type="file"
            multiple
            disabled={lleno}
            className="solo-lectores"
            accept={EXTENSIONES.map((e) => `.${e}`).join(',')}
            onChange={alElegir}
            tabIndex={-1}
            aria-hidden="true"
          />

          {/*
            El cupo, siempre a la vista y no solo cuando se llena: saber que el
            tope son cinco ANTES de elegir quince ficheros evita el viaje
            entero. `aria-live="polite"` porque el número baja y sube solo, al
            ritmo de las indexaciones, sin que el usuario haya tocado nada.
          */}
          <p id={idCupo} className={'text-[0.6875rem] text-tenue'} aria-live="polite">
            {lleno
              ? `${ingesta.maxEnVuelo} de ${ingesta.maxEnVuelo} en marcha: no caben más`
              : `Caben ${plural(ingesta.huecos)} más (${ingesta.maxEnVuelo} a la vez como máximo)`}
          </p>
          {aviso ? (
            <p
              className={
                'rounded-m border border-error-borde bg-error-fondo p-2 text-[0.8125rem] text-error'
              }
              role="alert"
            >
              {aviso}
            </p>
          ) : null}
          <Input
            etiqueta="…o una ruta que ya esté en el servidor"
            placeholder="/docs/manual.pdf"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </>
      )}

      {/* También sin huecos: una URL o una ruta del servidor son la misma
          indexación por detrás, y ocupan sitio igual que una subida. */}
      <Button type="submit" disabled={!valor.trim() || lleno}>
        Indexar
      </Button>

      {modo === 'fichero' ? (
        <p className={'text-[0.6875rem] text-tenue'}>
          Lo que sueltes se sube al servidor y se indexa. La ruta de arriba es para
          ficheros que ya estén en su disco.
        </p>
      ) : null}

      {ingesta.trabajos.length > 0 ? (
        <ul className={'flex flex-col gap-1.5'}>
          {ingesta.trabajos.map((trabajo) => (
            <li
              key={trabajo.id}
              className={clases(
                'flex flex-col gap-1 rounded-m border border-borde bg-superficie/60 p-2.5',
                trabajo.fase === 'error' && 'border-error-borde',
                trabajo.fase === 'hecho' && 'border-exito-borde',
              )}
            >
              {/* bdi evita que `direction: rtl`, que está ahí para recortar las
                  rutas largas por el principio, reordene el texto. */}
              <bdi
                className={'truncate font-mono text-[0.75rem] text-texto'}
                title={trabajo.origen}
              >
                {trabajo.origen}
              </bdi>

              {trabajo.fase === 'indexando' || trabajo.fase === 'en-cola' ? (
                <span className={'text-[0.6875rem] text-tenue'}>
                  <Spinner tamano="sm" etiqueta={`Indexando ${trabajo.origen}`} />
                </span>
              ) : null}
              {trabajo.fase === 'hecho' ? (
                <Badge tono="exito">{trabajo.fragmentos} frag.</Badge>
              ) : null}
              {trabajo.fase === 'error' ? (
                <span
                  className={clases('text-[0.6875rem] text-tenue', 'text-error')}
                  role="alert"
                >
                  {trabajo.mensaje}
                </span>
              ) : null}

              {trabajo.fase === 'hecho' || trabajo.fase === 'error' ? (
                <IconButton
                  etiqueta={`Quitar ${trabajo.origen} de la lista`}
                  icono={ICONO_QUITAR}
                  onClick={() => ingesta.olvidar(trabajo.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
