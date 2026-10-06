import { obtenerAjustesServidor } from '@/shared/api/ajustes';
import { useRecurso } from '@/shared/hooks/useRecurso';
import type { AjustesConsulta } from '@/shared/lib/consulta';
import { Button, Skeleton } from '@/shared/ui';

type Props = {
  consulta: AjustesConsulta;
  onCambiar: (consulta: AjustesConsulta) => void;
};

/**
 * Las opciones no están escritas aquí: se piden a `GET /ajustes`. Así la
 * interfaz no duplica los límites del servidor ni ofrece un modelo que él
 * vaya a rechazar con un 422.
 */
export function AjustesConsultaSeccion({ consulta, onCambiar }: Props) {
  const { estado, reintentar } = useRecurso(obtenerAjustesServidor);

  if (estado.fase === 'cargando') {
    return (
      <div className={'flex flex-col gap-2'} aria-busy="true">
        <Skeleton alto="2.5rem" />
        <Skeleton alto="2.5rem" />
      </div>
    );
  }

  if (estado.fase === 'error') {
    return (
      <div className={'opacity-50'} role="alert">
        <p>No se han podido leer los ajustes del servidor. {estado.mensaje}</p>
        <Button variante="secundario" tamano="sm" onClick={reintentar}>
          Reintentar
        </Button>
      </div>
    );
  }

  const { modelos, max_fragmentos_defecto, max_fragmentos_tope } = estado.datos;
  const fragmentos = consulta.maxFragmentos ?? max_fragmentos_defecto;

  return (
    <>
      <label className={'flex flex-col gap-2'} htmlFor="max-fragmentos">
        <span className={'flex items-center justify-between gap-2'}>
          Fragmentos por respuesta
          <output
            className={'tabular font-mono text-[0.75rem] text-acento'}
            htmlFor="max-fragmentos"
          >
            {fragmentos}
            {consulta.maxFragmentos === null ? ' (por defecto)' : ''}
          </output>
        </span>
        <input
          id="max-fragmentos"
          type="range"
          className={'w-full accent-[var(--acento)]'}
          min={1}
          max={max_fragmentos_tope}
          value={fragmentos}
          onChange={(e) =>
            onCambiar({ ...consulta, maxFragmentos: Number(e.target.value) })
          }
        />
      </label>
      <p className={'text-[0.6875rem] leading-snug text-tenue'}>
        Cuántos trozos de tus documentos recibe el modelo. Más contexto suele dar mejores
        respuestas, pero también las hace más lentas.
      </p>

      <div className={'flex flex-col gap-2'}>
        <span className="etiqueta-seccion">Modelo</span>
        <div className={'flex flex-col gap-1'}>
          {modelos.map((modelo) => (
            <button
              key={modelo}
              type="button"
              className={
                'rounded-s border border-borde px-2.5 py-1.5 text-start font-mono text-[0.75rem] text-suave transition-colors hover:bg-superficie-hover aria-pressed:border-acento aria-pressed:bg-acento-suave aria-pressed:text-acento'
              }
              aria-pressed={(consulta.modelo ?? modelos[0]) === modelo}
              onClick={() => onCambiar({ ...consulta, modelo })}
            >
              {/* El prefijo del proveedor no aporta en un selector de dos. */}
              {modelo.split('/').pop()}
            </button>
          ))}
        </div>
      </div>

      {consulta.maxFragmentos !== null || consulta.modelo !== null ? (
        <Button
          variante="secundario"
          tamano="sm"
          onClick={() => onCambiar({ maxFragmentos: null, modelo: null })}
        >
          Volver a los valores del servidor
        </Button>
      ) : null}
    </>
  );
}
