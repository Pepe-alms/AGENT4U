import { memo, useMemo, type MouseEvent } from 'react';

import { clases } from '@/shared/ui/clases';

import type { Fuente } from '@/shared/api/types';
import { markdownAHtml } from '@/shared/lib/markdown';
import estilos from '@/features/chat/Respuesta.module.css';

type Props = {
  texto: string;
  escribiendo: boolean;
  /** Las fuentes de este mensaje: deciden que `[n]` son citas validas y
   *  alimentan la vista previa de cada marcador. */
  fuentes: Fuente[];
  citaActiva: number | null;
  onElegirCita: (numero: number) => void;
  onApuntarCita: (numero: number | null) => void;
};

function RespuestaBase({
  texto,
  escribiendo,
  fuentes,
  citaActiva,
  onElegirCita,
  onApuntarCita,
}: Props) {
  // Re-parsear en cada chunk del stream seria tirar trabajo: se memoiza por
  // texto y por fuentes, que es lo unico que cambia el resultado.
  const html = useMemo(() => markdownAHtml(texto, fuentes), [texto, fuentes]);

  /** Devuelve el numero de cita si el evento salio de un marcador. */
  function citaDe(evento: MouseEvent<HTMLDivElement>): number | null {
    const origen = (evento.target as HTMLElement).closest<HTMLElement>('[data-cita]');
    const valor = origen?.dataset.cita;
    return valor ? Number(valor) : null;
  }

  /**
   * Los botones viven dentro del HTML inyectado, asi que no pueden tener su
   * propio `onClick` de React: todo se resuelve por delegacion desde aqui.
   */
  async function alPulsar(evento: MouseEvent<HTMLDivElement>) {
    const cita = citaDe(evento);
    if (cita !== null) {
      onElegirCita(cita);
      return;
    }

    const boton = (evento.target as HTMLElement).closest<HTMLElement>(
      '[data-copiar-codigo]',
    );
    if (!boton) return;

    const bloque = boton.closest('pre');
    const codigo =
      bloque?.querySelector('code')?.textContent ?? bloque?.textContent ?? '';

    try {
      await navigator.clipboard.writeText(codigo.replace(/^Copiar\n?/, ''));
      boton.textContent = 'Copiado';
      setTimeout(() => {
        boton.textContent = 'Copiar';
      }, 1800);
    } catch {
      // Sin portapapeles disponible, el codigo sigue seleccionable a mano.
    }
  }

  return (
    <div
      className={clases(estilos.prosa, escribiendo && estilos.escribiendo)}
      data-cita-activa={citaActiva ?? undefined}
      onClick={(evento) => void alPulsar(evento)}
      // `onMouseOver` y no `onMouseEnter`: el segundo no burbujea, asi que no
      // llegaria desde los botones de dentro del HTML inyectado.
      onMouseOver={(evento) => onApuntarCita(citaDe(evento))}
      onMouseOut={() => onApuntarCita(null)}
      onFocus={(evento) =>
        onApuntarCita(citaDe(evento as unknown as MouseEvent<HTMLDivElement>))
      }
      onBlur={() => onApuntarCita(null)}
      aria-live="polite"
      aria-busy={escribiendo}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Memoizado, y esto no es un adorno: sin él, pasar el ratón por encima de una
 * cita cambia `citaApuntada` en App, lo que re-renderiza este componente y hace
 * que React **reescriba el HTML inyectado**. El nodo sobre el que el usuario
 * iba a pulsar desaparece entre el `mousedown` y el `click`, y el clic se
 * pierde. Lo cazó la prueba de punta a punta de la iteración 022.
 *
 * Sus props son estables (`onElegirCita` y `onApuntarCita` vienen envueltas en
 * `useCallback`), así que el hover ya no llega hasta aquí.
 */
export default memo(RespuestaBase);
