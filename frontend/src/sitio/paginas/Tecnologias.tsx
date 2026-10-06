import { useCallback, useMemo } from 'react';

import { useSearchParams } from 'react-router';

import { AnteriorSiguiente } from '@/sitio/componentes/AnteriorSiguiente';
import { CabeceraPagina } from '@/sitio/componentes/CabeceraPagina';
import { Migas } from '@/sitio/componentes/Migas';
import { Revelar } from '@/sitio/componentes/Revelar';
import { rutaPorId } from '@/routes';
import { useScrollToHash } from '@/sitio/useScrollToHash';
import {
  CAPAS,
  SLUG_CAPA,
  TECNOLOGIAS,
  capaDeSlug,
  type Capa,
} from '@/sitio/datos/tecnologias';

/** `null` es "todas": un filtro sin forma de deshacerse es una trampa. */
type Filtro = Capa | null;

function Chips({
  activo,
  onElegir,
}: {
  activo: Filtro;
  onElegir: (capa: Filtro) => void;
}) {
  const chip = (texto: string, seleccionado: boolean, alPulsar: () => void) => (
    <li key={texto}>
      <button
        type="button"
        aria-pressed={seleccionado}
        onClick={alPulsar}
        className={[
          'rounded-full border px-4 py-2 text-[0.875rem] font-medium transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto',
          // El seleccionado se rellena en negro. Es la unica pieza rellena de
          // la pagina, y vuelve a estar sola en cuanto se elige otra.
          seleccionado
            ? 'border-acento bg-acento text-sobre-acento'
            : 'border-borde text-texto hover:bg-superficie-suave',
        ].join(' ')}
      >
        {texto}
      </button>
    </li>
  );

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Filtrar por capa">
      {chip('Todas', activo === null, () => onElegir(null))}
      {CAPAS.map((capa) => chip(capa, activo === capa, () => onElegir(capa)))}
    </ul>
  );
}

export function Tecnologias() {
  // El ancla del hash, con la pagina ya montada: ver useScrollToHash.
  useScrollToHash();

  const ruta = rutaPorId('tecnologias')!;
  /*
   * El filtro vive en la query y no en un `useState`.
   *
   * Asi la URL con el filtro puesto se copia y se abre en otra pestaña con la
   * misma vista, que es como se comparte "mira las de backend". Un slug que no
   * corresponda a ninguna capa se trata como "todas", en vez de dejar la
   * pagina vacia sin explicar por que.
   */
  const [params, setParams] = useSearchParams();
  const filtro = capaDeSlug(params.get('capa'));

  const elegir = useCallback(
    (capa: Filtro) => {
      const siguientes = new URLSearchParams(params);
      if (capa) siguientes.set('capa', SLUG_CAPA[capa]);
      else siguientes.delete('capa');
      // `replace`: filtrar no es navegar. Con `push`, volver atras obligaria a
      // deshacer uno a uno todos los chips que se hayan pulsado.
      setParams(siguientes, { replace: true });
    },
    [params, setParams],
  );

  const visibles = useMemo(
    () => (filtro === null ? TECNOLOGIAS : TECNOLOGIAS.filter((t) => t.capa === filtro)),
    [filtro],
  );

  /*
   * Sin filtro se agrupa por capa, con su cabecera; con filtro se enseña una
   * sola rejilla. Repetir la cabecera de la capa cuando ya la has elegido en
   * el chip es decir dos veces lo mismo.
   */
  const grupos = useMemo(
    () =>
      filtro === null
        ? CAPAS.map((capa) => ({
            capa,
            items: TECNOLOGIAS.filter((t) => t.capa === capa),
          })).filter((g) => g.items.length > 0)
        : [{ capa: filtro, items: visibles }],
    [filtro, visibles],
  );

  return (
    <>
      <Migas id="tecnologias" />
      <CabeceraPagina
        eyebrow={ruta.eyebrow!}
        titulo={ruta.titulo!}
        entradilla={ruta.entradilla!}
        paleta={ruta.paleta!}
        forma={ruta.forma}
      />

      <section className="py-16 sm:py-20">
        <Revelar>
          <Chips activo={filtro} onElegir={elegir} />
        </Revelar>

        <p className="mt-6 text-[0.875rem] text-tenue" aria-live="polite">
          {visibles.length} {visibles.length === 1 ? 'herramienta' : 'herramientas'}
          {filtro ? ` en ${filtro}` : ''}
        </p>

        <div className="mt-10 flex flex-col gap-14">
          {grupos.map((grupo) => (
            <section key={grupo.capa} className="flex flex-col gap-6">
              {filtro === null ? (
                <Revelar>
                  <h2 className="text-[1.375rem] font-medium tracking-[-0.02em]">
                    {grupo.capa}
                  </h2>
                </Revelar>
              ) : null}

              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grupo.items.map((tecnologia, indice) => (
                  <Revelar
                    key={tecnologia.nombre}
                    indice={indice}
                    como="li"
                    className="flex flex-col gap-3 rounded-m border border-borde p-5"
                  >
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-[1.0625rem] font-medium tracking-[-0.01em]">
                          {tecnologia.nombre}
                        </h3>
                        {/* La version en pildora con hairline: es un dato, no
                            una accion, asi que no se rellena. */}
                        <span className="shrink-0 rounded-full border border-borde px-2.5 py-0.5 font-mono text-[0.6875rem] text-tenue">
                          {tecnologia.version}
                        </span>
                      </div>
                      <p className="text-[0.9375rem] text-suave">{tecnologia.paraQue}</p>
                    </>
                  </Revelar>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <AnteriorSiguiente id="tecnologias" />
    </>
  );
}

export default Tecnologias;
