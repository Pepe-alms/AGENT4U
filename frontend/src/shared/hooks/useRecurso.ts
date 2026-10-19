import { useCallback, useEffect, useState } from 'react';

import { mensajeDeError } from '@/shared/api/errores';

/**
 * Un unico estado con variantes excluyentes en vez de varios booleanos: asi es
 * imposible representar "cargando y con error a la vez", que es el fallo
 * clasico de `useState(false)` por cada cosa.
 */
export type EstadoRecurso<T> =
  { fase: 'cargando' } | { fase: 'error'; mensaje: string } | { fase: 'listo'; datos: T };

/**
 * Carga algo de la API con sus tres estados y un reintento.
 *
 * `cargar` tiene que ser estable (definida fuera del componente o envuelta en
 * `useCallback`): es la dependencia que decide cuando se vuelve a pedir.
 */
export function useRecurso<T>(
  cargar: (opciones: { signal?: AbortSignal }) => Promise<T>,
): { estado: EstadoRecurso<T>; reintentar: () => void } {
  const [estado, setEstado] = useState<EstadoRecurso<T>>({ fase: 'cargando' });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const control = new AbortController();

    cargar({ signal: control.signal })
      .then((datos) => setEstado({ fase: 'listo', datos }))
      .catch((error: unknown) => {
        // Al desmontar, el abort entra por aqui: no es un fallo que mostrar.
        if (control.signal.aborted) return;
        setEstado({ fase: 'error', mensaje: mensajeDeError(error) });
      });

    return () => control.abort();
  }, [cargar, intento]);

  // El paso a "cargando" se hace aqui, en el evento que lo causa, y no dentro
  // del efecto: el estado inicial ya es "cargando" y hacerlo alli provocaria
  // un render en cascada en cada montaje.
  const reintentar = useCallback(() => {
    setEstado({ fase: 'cargando' });
    setIntento((n) => n + 1);
  }, []);

  return { estado, reintentar };
}
