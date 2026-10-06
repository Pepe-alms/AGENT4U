import { useEffect, useRef, useState } from 'react';

import { Check, Link2 } from 'lucide-react';

/** Lo que tarda en volver a su estado normal. */
const CONFIRMACION_MS = 2200;

/**
 * Copia al portapapeles la URL que se le pase.
 *
 * La confirmacion va por `aria-live` y no solo por el cambio de icono: quien
 * usa lector de pantalla no ve que el icono pase a un visto, y "no ha pasado
 * nada" es indistinguible de "ha fallado".
 *
 * Si el portapapeles no esta disponible —contexto no seguro, permiso
 * denegado— se dice, en vez de fingir que ha ido bien.
 */
export function CopiarEnlace({
  url,
  etiqueta = 'Copiar enlace',
  className,
}: {
  url: string;
  etiqueta?: string;
  className?: string;
}) {
  const [estado, setEstado] = useState<'listo' | 'copiado' | 'fallo'>('listo');
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Si el componente se va con la confirmación en pantalla, el temporizador
  // seguiría vivo y dispararía sobre algo que ya no existe.
  useEffect(
    () => () => {
      if (reloj.current) clearTimeout(reloj.current);
    },
    [],
  );

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setEstado('copiado');
    } catch {
      setEstado('fallo');
    }
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = setTimeout(() => setEstado('listo'), CONFIRMACION_MS);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void copiar()}
        className={[
          'flex items-center gap-1.5 rounded-full border border-borde px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
          'hover:bg-superficie-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto',
          className ?? '',
        ].join(' ')}
      >
        {estado === 'copiado' ? (
          <Check size={14} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Link2 size={14} strokeWidth={1.5} aria-hidden="true" />
        )}
        {etiqueta}
      </button>

      {/*
        La región existe SIEMPRE, vacía. Montarla al tener algo que decir no
        anuncia nada: el lector solo lee los cambios de una región que ya
        estaba vigilando.
      */}
      <span role="status" aria-live="polite" className="solo-lectores">
        {estado === 'copiado' ? 'Enlace copiado' : ''}
        {estado === 'fallo' ? 'No se ha podido copiar el enlace' : ''}
      </span>
    </>
  );
}
