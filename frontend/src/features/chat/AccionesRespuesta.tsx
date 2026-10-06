import { useState } from 'react';

import { Copy, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';

import type { MensajeChat } from '@/features/chat/estado';
import { copiarConReferencias } from '@/shared/lib/referencias';
import { valoracionesLocales, type Valoracion } from '@/shared/lib/valoraciones';
import { Button } from '@/shared/ui/Button';
import { clases } from '@/shared/ui/clases';
import { Tooltip } from '@/shared/ui/Tooltip';

type Props = {
  mensaje: MensajeChat;
  clave: string;
  onRegenerar: () => void;
};

const CONFIRMACION_MS = 1800;

export function AccionesRespuesta({ mensaje, clave, onRegenerar }: Props) {
  // El valor inicial se lee del repositorio, no de un efecto: así no hay un
  // primer render en el que la valoración guardada aparezca apagada.
  const [valoracion, setValoracion] = useState<Valoracion | null>(() =>
    valoracionesLocales.leer(clave),
  );
  const [copiado, setCopiado] = useState(false);

  function valorar(nueva: Valoracion) {
    // Pulsar la que ya está puesta la quita: así se puede deshacer.
    const siguiente = valoracion === nueva ? null : nueva;
    setValoracion(siguiente);
    valoracionesLocales.guardar(clave, siguiente);
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(
        copiarConReferencias(mensaje.contenido, mensaje.fuentes ?? []),
      );
      setCopiado(true);
      setTimeout(() => setCopiado(false), CONFIRMACION_MS);
    } catch {
      // Sin portapapeles el texto sigue siendo seleccionable a mano.
    }
  }

  return (
    <div className="mt-3 -ms-2 flex items-center gap-0.5">
      <Tooltip texto="Volver a preguntar lo mismo">
        <Button variante="fantasma" tamano="sm" onClick={onRegenerar}>
          <RefreshCw size={14} />
          Regenerar
        </Button>
      </Tooltip>

      <Tooltip texto="Copiar la respuesta con sus fuentes">
        <Button variante="fantasma" tamano="sm" onClick={() => void copiar()}>
          <Copy size={14} />
          {/* aria-live para que el lector de pantalla anuncie la confirmación:
              si no, el cambio de texto del botón pasa desapercibido. */}
          <span aria-live="polite">{copiado ? 'Copiado' : 'Copiar'}</span>
        </Button>
      </Tooltip>

      <span className="mx-1.5 h-4 w-px bg-borde" aria-hidden="true" />

      <Tooltip texto="Esta respuesta me ha servido">
        <Button
          variante="fantasma"
          tamano="sm"
          aria-pressed={valoracion === 'util'}
          aria-label="Marcar la respuesta como útil"
          className={clases(valoracion === 'util' && 'bg-exito-fondo text-exito')}
          onClick={() => valorar('util')}
        >
          <ThumbsUp size={14} />
        </Button>
      </Tooltip>

      <Tooltip texto="Esta respuesta no me sirve">
        <Button
          variante="fantasma"
          tamano="sm"
          aria-pressed={valoracion === 'inutil'}
          aria-label="Marcar la respuesta como no útil"
          className={clases(valoracion === 'inutil' && 'bg-error-fondo text-error')}
          onClick={() => valorar('inutil')}
        >
          <ThumbsDown size={14} />
        </Button>
      </Tooltip>
    </div>
  );
}
