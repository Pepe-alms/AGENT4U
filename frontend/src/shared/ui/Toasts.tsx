import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { AlertTriangle, Check, X } from 'lucide-react';

import type { Avisos } from '@/shared/hooks/useAvisos';

/**
 * Confirmaciones de lo que acaba de pasar.
 *
 * Son **solo visuales** (`aria-hidden`), y eso es deliberado: quien use lector
 * de pantalla ya recibe el mismo texto por la region de anuncios de
 * `Anuncios.tsx`. Dos regiones `aria-live` para lo mismo harian que todo se
 * leyera dos veces.
 */
export function Toasts({ toasts, descartar }: Pick<Avisos, 'toasts' | 'descartar'>) {
  return (
    <div
      /* Abajo a la derecha y no centrado: en el centro quedaba justo encima
         del composer. Lo cazó la prueba de punta a punta, que no conseguía
         pulsar una cita mientras había un aviso en pantalla. */
      className="pointer-events-none fixed end-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      aria-hidden="true"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <m.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.2, 0.9, 0.2, 1] }}
            className={[
              // Sin `pointer-events`: un aviso es informacion, no una
              // barrera. Solo su boton de cerrar captura el raton.
              'flex items-center gap-2.5 rounded-m border px-3 py-2.5 text-sm shadow-l backdrop-blur-lg',
              toast.tono === 'error'
                ? 'border-error-borde bg-error-fondo text-error'
                : 'border-borde-fuerte bg-superficie text-texto',
            ].join(' ')}
          >
            {toast.tono === 'error' ? (
              <AlertTriangle size={15} className="shrink-0" />
            ) : (
              <Check size={15} className="shrink-0 text-exito" />
            )}
            <span className="flex-1">{toast.texto}</span>
            <button
              type="button"
              onClick={() => descartar(toast.id)}
              className="pointer-events-auto -me-1 grid size-6 shrink-0 place-items-center rounded-s text-tenue transition-colors hover:text-texto"
              // Visible solo para el raton: el lector ya tiene el texto por la
              // region de anuncios y este boton no le aporta nada.
              tabIndex={-1}
            >
              <X size={14} />
            </button>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
