import { useEffect, useRef } from 'react';

import { AjustesConsultaSeccion } from '@/features/ajustes/AjustesConsultaSeccion';
import type { Preferencias } from '@/features/ajustes/usePreferencias';
import { ETIQUETA_DENSIDAD, type Densidad } from '@/shared/lib/densidad';
import { NOMBRE_TEMA, type Tema } from '@/shared/lib/tema';
import { IconButton } from '@/shared/ui/IconButton';

const ICONO_CERRAR = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
    <path
      d="m6 6 12 12M18 6 6 18"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const TEMAS: Tema[] = ['sistema', 'claro', 'oscuro'];
const DENSIDADES: Densidad[] = ['comoda', 'compacta'];

type Props = {
  abierto: boolean;
  alCerrar: () => void;
  preferencias: Preferencias;
};

/**
 * Sobre `<dialog>` nativo, igual que los drawers: `showModal()` ya trae foco
 * atrapado, cierre con Escape, `::backdrop` y el resto de la pagina inerte.
 */
export function PanelAjustes({ abierto, alCerrar, preferencias }: Props) {
  const referencia = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogo = referencia.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  // El evento 'close' se escucha en el DOM y no con la prop `onClose`: no
  // burbujea, y si no llegase a React el estado del padre se quedaria en
  // "abierto" y el boton no volveria a abrirlo.
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
      className={
        'fixed inset-y-0 end-0 hidden h-dvh w-[min(24rem,92vw)] max-w-none flex-col overflow-hidden rounded-s-l border border-borde bg-superficie p-0 text-texto shadow-l backdrop:bg-black/55 backdrop:backdrop-blur-[2px] open:flex motion-safe:open:animate-[entrar-fin_260ms_var(--curva-entrada)]'
      }
      aria-label="Ajustes"
      onClick={(evento) => {
        if (evento.target === referencia.current) alCerrar();
      }}
    >
      <div
        className={
          'flex shrink-0 items-center justify-between gap-2 border-b border-borde px-4 py-3'
        }
      >
        <span className={'text-sm font-semibold'}>Ajustes</span>
        <IconButton
          etiqueta="Cerrar los ajustes"
          icono={ICONO_CERRAR}
          onClick={alCerrar}
        />
      </div>

      <div className={'flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4'}>
        <fieldset className={'flex flex-col gap-2'}>
          <legend className="etiqueta-seccion">Tema</legend>
          <div className={'flex gap-1 rounded-m border border-borde p-1'}>
            {TEMAS.map((opcion) => (
              <button
                key={opcion}
                type="button"
                className={
                  'flex-1 rounded-s px-2 py-1.5 text-[0.8125rem] text-suave transition-colors hover:bg-superficie-hover aria-pressed:bg-acento-suave aria-pressed:font-medium aria-pressed:text-acento'
                }
                aria-pressed={preferencias.tema === opcion}
                onClick={() => preferencias.elegirTema(opcion)}
              >
                {NOMBRE_TEMA[opcion]}
              </button>
            ))}
          </div>
          <p className={'text-[0.6875rem] leading-snug text-tenue'}>
            «El del sistema» sigue la preferencia de tu equipo y cambia sola si él cambia.
          </p>
        </fieldset>

        <fieldset className={'flex flex-col gap-2'}>
          <legend className="etiqueta-seccion">Densidad</legend>
          <div className={'flex gap-1 rounded-m border border-borde p-1'}>
            {DENSIDADES.map((opcion) => (
              <button
                key={opcion}
                type="button"
                className={
                  'flex-1 rounded-s px-2 py-1.5 text-[0.8125rem] text-suave transition-colors hover:bg-superficie-hover aria-pressed:bg-acento-suave aria-pressed:font-medium aria-pressed:text-acento'
                }
                aria-pressed={preferencias.densidad === opcion}
                onClick={() => preferencias.elegirDensidad(opcion)}
              >
                {ETIQUETA_DENSIDAD[opcion]}
              </button>
            ))}
          </div>
          <p className={'text-[0.6875rem] leading-snug text-tenue'}>
            La compacta aprieta los márgenes para que quepa más. El tamaño del texto y de
            los botones no cambia.
          </p>
        </fieldset>

        <fieldset className={'flex flex-col gap-2'}>
          <legend className="etiqueta-seccion">Consulta</legend>
          {/* Solo se monta con el panel abierto, así que la petición a
              /ajustes no se hace al arrancar la aplicación. */}
          <AjustesConsultaSeccion
            consulta={preferencias.consulta}
            onCambiar={preferencias.elegirConsulta}
          />
        </fieldset>
      </div>
    </dialog>
  );
}
