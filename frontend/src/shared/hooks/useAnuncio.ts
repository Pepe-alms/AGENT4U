import { useCallback, useState } from 'react';

/**
 * Texto que se le lee a quien use lector de pantalla.
 *
 * Se le anade un sufijo invisible cuando el mensaje se repite: `aria-live`
 * solo anuncia los **cambios**, asi que decir dos veces seguidas "respuesta
 * lista" no se oiria la segunda vez.
 */
export function useAnuncio(): { mensaje: string; anunciar: (texto: string) => void } {
  const [mensaje, setMensaje] = useState('');

  const anunciar = useCallback((texto: string) => {
    setMensaje((anterior) => {
      const limpio = anterior.replace(/​+$/, '');
      // Un espacio de ancho cero: no se lee, pero hace que la cadena cambie.
      return limpio === texto ? `${texto}​` : texto;
    });
  }, []);

  return { mensaje, anunciar };
}
