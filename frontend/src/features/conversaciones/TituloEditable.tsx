import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

type Props = {
  titulo: string;
  onGuardar: (titulo: string) => void;
  onCancelar: () => void;
};

/**
 * Campo para renombrar en el sitio. Enter guarda, Escape cancela y perder el
 * foco guarda también: salir pinchando fuera es una forma normal de terminar, y
 * descartar lo escrito ahí sorprende.
 */
export function TituloEditable({ titulo, onGuardar, onCancelar }: Props) {
  const [valor, setValor] = useState(titulo);
  const campo = useRef<HTMLInputElement>(null);
  // Evita guardar dos veces cuando Enter provoca además la pérdida de foco.
  const cerrado = useRef(false);

  useEffect(() => {
    campo.current?.focus();
    campo.current?.select();
  }, []);

  function guardar() {
    if (cerrado.current) return;
    cerrado.current = true;

    const limpio = valor.trim();
    // Sin cambios o vacío: se cancela, que es lo mismo pero sin molestar al
    // servidor con una petición que no cambia nada.
    if (!limpio || limpio === titulo) onCancelar();
    else onGuardar(limpio);
  }

  function alPulsar(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      guardar();
    }
    if (evento.key === 'Escape') {
      evento.preventDefault();
      cerrado.current = true;
      onCancelar();
    }
  }

  return (
    <input
      ref={campo}
      className="w-full rounded-m border border-borde-fuerte bg-superficie px-2 py-1.5 text-sm text-texto outline-none"
      value={valor}
      maxLength={256}
      aria-label="Nuevo título de la conversación"
      onChange={(e) => setValor(e.target.value)}
      onKeyDown={alPulsar}
      onBlur={guardar}
      // El clic dentro no debe abrir la conversación de debajo.
      onClick={(e) => e.stopPropagation()}
    />
  );
}
