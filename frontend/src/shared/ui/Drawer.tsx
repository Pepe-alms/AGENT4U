import { useEffect, useRef, type ReactNode } from 'react';

import { X } from 'lucide-react';

import { IconButton } from '@/shared/ui/IconButton';

type Lado = 'inicio' | 'fin' | 'abajo';

type Props = {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  /** De donde entra. 'inicio' es la izquierda en es-ES. */
  lado?: Lado;
  children: ReactNode;
};

/*
 * El `display` va atado a `[open]`: un `display` suelto en el selector base
 * gana a la regla del user agent y deja los paneles visibles al cargar.
 */
const COLOCACION: Record<Lado, string> = {
  inicio: 'open:flex inset-y-0 start-0 h-dvh w-[min(20rem,85vw)] border-e',
  fin: 'open:flex inset-y-0 end-0 h-dvh w-[min(22rem,88vw)] border-s',
  // Hoja inferior: en movil el pulgar llega abajo y no al borde lateral.
  abajo: 'open:flex inset-x-0 bottom-0 max-h-[82dvh] w-full rounded-t-m border-t',
};

const ENTRADA: Record<Lado, string> = {
  inicio: 'motion-safe:open:animate-[entrar-inicio_260ms_var(--curva-entrada)]',
  fin: 'motion-safe:open:animate-[entrar-fin_260ms_var(--curva-entrada)]',
  abajo: 'motion-safe:open:animate-[entrar-abajo_300ms_var(--curva-entrada)]',
};

/**
 * Panel modal sobre `<dialog>` nativo.
 *
 * Se usa el elemento nativo y no un div a medida porque `showModal()` ya trae
 * foco atrapado, cierre con Escape, `::backdrop` y el resto de la pagina
 * marcada como inerte. Reimplementar eso a mano es justo donde fallan estos
 * componentes, y la alternativa seria una libreria entera de dialogos.
 */
export function Drawer({ abierto, alCerrar, titulo, lado = 'inicio', children }: Props) {
  const referencia = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogo = referencia.current;
    if (!dialogo) return;

    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  // El evento 'close' se escucha en el DOM y no con la prop `onClose`: no
  // burbujea, y si no llega a React el estado del padre se queda en "abierto"
  // mientras el dialogo ya esta cerrado. A partir de ahi el boton no vuelve a
  // abrirlo nunca, porque poner a true algo que ya es true no dispara efecto.
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
      aria-label={titulo}
      className={[
        'fixed hidden max-w-none flex-col overflow-hidden p-0',
        'border-borde bg-superficie text-texto shadow-l',
        'backdrop:bg-black/25 backdrop:backdrop-blur-sm',
        COLOCACION[lado],
        ENTRADA[lado],
      ].join(' ')}
      onClick={(evento) => {
        if (evento.target === referencia.current) alCerrar();
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-2">
        <span className="text-[1.0625rem] font-medium tracking-[-0.01em]">{titulo}</span>
        <IconButton etiqueta="Cerrar" icono={<X size={18} />} onClick={alCerrar} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </dialog>
  );
}
