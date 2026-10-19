import { useEffect } from 'react';

export type Atajo = {
  /** La tecla, en minuscula: 'k', 'n', 'escape'… */
  tecla: string;
  /** Cmd en macOS, Ctrl en el resto. */
  conModificador?: boolean;
  /** Si debe funcionar tambien mientras se escribe. Por defecto, no. */
  enCampos?: boolean;
};

function esCampoDeTexto(destino: EventTarget | null): boolean {
  if (!(destino instanceof HTMLElement)) return false;
  if (destino.isContentEditable) return true;
  return ['input', 'textarea', 'select'].includes(destino.tagName.toLowerCase());
}

/**
 * Registra un atajo global.
 *
 * Por defecto **no se dispara mientras se escribe**: un atajo de una sola tecla
 * que robe la «n» a mitad de una pregunta es peor que no tenerlo. Los que
 * llevan modificador sí funcionan en todas partes, porque Cmd+K no se teclea
 * por accidente.
 */
export function useAtajo(atajo: Atajo, accion: () => void): void {
  const { tecla, conModificador = false, enCampos = conModificador } = atajo;

  useEffect(() => {
    function alPulsar(evento: KeyboardEvent) {
      if (evento.key.toLowerCase() !== tecla) return;

      // metaKey es Cmd en macOS; ctrlKey cubre Windows y Linux.
      const modificador = evento.metaKey || evento.ctrlKey;
      if (conModificador !== modificador) return;

      if (!enCampos && esCampoDeTexto(evento.target)) return;

      evento.preventDefault();
      accion();
    }

    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [tecla, conModificador, enCampos, accion]);
}

/** Cmd en macOS, Ctrl en el resto. Solo para mostrarlo, no para comparar. */
export const TECLA_MODIFICADORA =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';
