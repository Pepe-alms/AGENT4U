import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type TonoToast = 'exito' | 'error';

export type Toast = {
  id: number;
  texto: string;
  tono: TonoToast;
};

/** Mas de tres a la vez tapan la interfaz en vez de informar. */
const MAXIMO = 3;

/** Lo que tarda en irse solo. Un error se queda mas: hay que poder leerlo. */
const DURACION: Record<TonoToast, number> = { exito: 2600, error: 6000 };

export type Avisos = {
  toasts: Toast[];
  /** Enseña un aviso y lo retira solo. Devuelve nada: no hay que esperarlo. */
  avisar: (texto: string, tono?: TonoToast) => void;
  descartar: (id: number) => void;
};

export function useAvisos(): Avisos {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const siguiente = useRef(0);
  const relojes = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // Si la vista se desmonta con avisos en pantalla, sus temporizadores
  // seguirian vivos y dispararian sobre un componente que ya no existe.
  useEffect(() => {
    const vigentes = relojes.current;
    return () => {
      for (const reloj of vigentes.values()) clearTimeout(reloj);
      vigentes.clear();
    };
  }, []);

  const descartar = useCallback((id: number) => {
    const reloj = relojes.current.get(id);
    if (reloj) {
      clearTimeout(reloj);
      relojes.current.delete(id);
    }
    setToasts((actuales) => actuales.filter((t) => t.id !== id));
  }, []);

  const avisar = useCallback(
    (texto: string, tono: TonoToast = 'exito') => {
      const id = siguiente.current++;
      // Se descartan los mas viejos: lo ultimo que ha pasado es lo que
      // interesa, y una pila creciente acaba cubriendo la pantalla.
      setToasts((actuales) => [...actuales, { id, texto, tono }].slice(-MAXIMO));
      relojes.current.set(
        id,
        setTimeout(() => descartar(id), DURACION[tono]),
      );
    },
    [descartar],
  );

  // `avisar` y `descartar` son estables; `toasts` no, y por eso este objeto
  // cambia cuando hay un aviso nuevo. Quien lo use en las dependencias de un
  // efecto debe sacar la funcion que necesita, no pasar el objeto entero: eso
  // redispara el efecto, y si el efecto crea un aviso se realimenta.
  return useMemo(() => ({ toasts, avisar, descartar }), [toasts, avisar, descartar]);
}
