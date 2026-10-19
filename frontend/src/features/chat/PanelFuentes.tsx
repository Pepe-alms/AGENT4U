import { useEffect, useRef, type CSSProperties } from 'react';

import { FileCode, FileText, FileType, Globe, Search, Quote } from 'lucide-react';

import type { Fuente } from '@/shared/api/types';

type Props = {
  fuentes: Fuente[];
  /** La cita pulsada: su tarjeta se marca y se trae a la vista. */
  citaActiva: number | null;
  /** La cita bajo el raton: su tarjeta se ilumina, sin mover el scroll. */
  citaApuntada: number | null;
  onApuntarCita: (numero: number | null) => void;
};

/** El icono sale de la extension, que es lo unico que manda el backend. */
function iconoDe(nombre: string, origen: string) {
  if (/^https?:/i.test(origen)) return Globe;
  const extension = nombre.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'pdf') return FileType;
  if (['md', 'txt', 'rst'].includes(extension)) return FileText;
  if (['py', 'ts', 'js', 'json', 'yaml', 'yml', 'html'].includes(extension)) {
    return FileCode;
  }
  return FileText;
}

/**
 * Las fuentes de la ultima respuesta, una tarjeta por fragmento.
 *
 * Sincronizacion en los dos sentidos con las citas del texto: pulsar `[2]`
 * marca esta tarjeta y la trae a la vista; pasar el raton por una la enciende
 * en el texto.
 */
export function PanelFuentes({
  fuentes,
  citaActiva,
  citaApuntada,
  onApuntarCita,
}: Props) {
  const lista = useRef<HTMLUListElement>(null);

  // Traer a la vista la tarjeta elegida. Va en un efecto porque es una
  // consecuencia de que cambie `citaActiva`, venga de donde venga: del clic en
  // la cita o de la paleta de comandos.
  useEffect(() => {
    if (citaActiva === null) return;
    const tarjeta = lista.current?.querySelector(`[data-fuente="${citaActiva}"]`);
    tarjeta?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [citaActiva]);

  if (fuentes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <span
          className="grid size-12 place-items-center rounded-full border border-borde text-tenue"
          aria-hidden="true"
        >
          <Quote size={18} />
        </span>
        <p className="text-sm font-medium text-suave">Sin fuentes todavía</p>
        <p className="max-w-[28ch] text-[0.8125rem] text-balance text-tenue">
          Cuando preguntes, aquí aparecerá cada fragmento que el agente haya usado, con su
          documento, su página y lo relevante que era.
        </p>
      </div>
    );
  }

  // El score del reordenador no esta acotado y puede ser negativo, asi que la
  // barra se dibuja RELATIVA al mejor fragmento de esta respuesta. No es un
  // porcentaje de nada: es "como de bueno es comparado con el mejor de aqui".
  const scores = fuentes.map((f) => f.score).filter((s): s is number => s != null);
  const maximo = scores.length ? Math.max(...scores) : null;
  const minimo = scores.length ? Math.min(...scores) : null;

  return (
    <div className="flex flex-col gap-2 p-3">
      <h2 className="etiqueta-seccion px-1">
        {fuentes.length} {fuentes.length === 1 ? 'fuente' : 'fuentes'}
      </h2>

      <ul className="flex flex-col gap-2" ref={lista}>
        {fuentes.map((fuente, indice) => {
          const numero = indice + 1;
          const Icono = iconoDe(fuente.nombre, fuente.origen);
          const activa = citaActiva === numero;
          const apuntada = citaApuntada === numero;

          // Con un solo fragmento, o si todos empatan, la barra se llena: no
          // hay con que comparar y fingir una gradacion seria inventarsela.
          const proporcion =
            fuente.score == null || maximo == null || minimo == null
              ? null
              : maximo === minimo
                ? 1
                : (fuente.score - minimo) / (maximo - minimo);

          return (
            <li
              key={`${fuente.nombre}-${indice}`}
              data-fuente={numero}
              className="entra"
              style={{ '--indice': indice } as CSSProperties}
              onMouseEnter={() => onApuntarCita(numero)}
              onMouseLeave={() => onApuntarCita(null)}
            >
              <article
                /* Semantico y no una clase: dice cual es la fuente que se
                   esta mirando, lo lee un lector de pantalla y no se rompe al
                   cambiar los estilos. */
                aria-current={activa ? 'true' : undefined}
                className={[
                  'flex flex-col gap-2 rounded-m border p-3 transition-colors duration-200',
                  // La estructura la da el HAIRLINE, no una sombra. Sin color
                  // de marca, el estado se señala oscureciendo esa linea:
                  // activa = borde opaco, apuntada = a medio camino.
                  activa
                    ? 'border-texto bg-superficie-suave'
                    : apuntada
                      ? 'border-borde-fuerte'
                      : 'border-borde',
                ].join(' ')}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="tabular mt-px shrink-0 font-mono text-[0.6875rem] font-semibold text-suave"
                    aria-hidden="true"
                  >
                    [{numero}]
                  </span>
                  <Icono
                    size={14}
                    className="mt-px shrink-0 text-tenue"
                    aria-hidden="true"
                  />
                  <h3
                    className="min-w-0 flex-1 truncate font-mono text-[0.75rem] font-semibold text-texto"
                    title={fuente.origen || fuente.nombre}
                  >
                    {fuente.nombre}
                  </h3>
                </div>

                {fuente.headings.length || fuente.paginas.length ? (
                  <p className="text-[0.6875rem] text-tenue">
                    {fuente.headings.join(' › ')}
                    {fuente.headings.length && fuente.paginas.length ? ' · ' : ''}
                    {fuente.paginas.length ? (
                      <span className="tabular font-mono">
                        pág. {fuente.paginas.join(', ')}
                      </span>
                    ) : null}
                  </p>
                ) : null}

                {fuente.texto ? (
                  <p className="line-clamp-4 text-[0.8125rem] leading-relaxed text-suave">
                    {fuente.texto}
                  </p>
                ) : null}

                <div className="flex items-center gap-2">
                  {proporcion !== null ? (
                    <>
                      <span
                        className="h-1 flex-1 overflow-hidden rounded-full bg-superficie-hover"
                        aria-hidden="true"
                      >
                        <span
                          className="block h-full rounded-full bg-texto transition-[width] duration-500"
                          style={{ width: `${Math.max(proporcion * 100, 6)}%` }}
                        />
                      </span>
                      <span
                        className="tabular font-mono text-[0.625rem] text-tenue"
                        title="Puntuación del reordenador. No es un porcentaje: solo sirve para comparar los fragmentos de esta respuesta entre sí."
                      >
                        {fuente.score?.toFixed(2)}
                      </span>
                    </>
                  ) : null}
                </div>

                {/* Con multiconsulta, la pregunta que encontro el fragmento no
                    es la que escribio el usuario. Enseñarlo es la mitad de la
                    trazabilidad de un RAG agentico. */}
                {fuente.subconsulta ? (
                  <p className="flex items-start gap-1.5 text-[0.625rem] text-tenue">
                    <Search size={10} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="italic">{fuente.subconsulta}</span>
                  </p>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
