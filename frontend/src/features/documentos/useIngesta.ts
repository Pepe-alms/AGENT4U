import { useCallback, useReducer } from 'react';

import { indexarFichero, indexarUrl, subirFichero } from '@/shared/api/documentos';
import { ErrorApi, mensajeDeError } from '@/shared/api/errores';
import {
  mensajeDeIngesta,
  reducirIngesta,
  type Trabajo,
} from '@/features/documentos/ingesta';

export type Ingesta = {
  trabajos: Trabajo[];
  indexar: (origen: string, clase: 'fichero' | 'url') => void;
  /** Sube el fichero al servidor y lo indexa en una sola petición. */
  subir: (ficheros: File[]) => void;
  olvidar: (id: string) => void;
};

/**
 * Lanza indexaciones y lleva la cuenta de cada una por separado.
 *
 * `alTerminar` lo usa quien monta esto para recargar la lista de documentos:
 * el hook no sabe nada de esa lista, solo avisa de que algo ha cambiado.
 */
export function useIngesta(alTerminar: () => void): Ingesta {
  const [trabajos, despachar] = useReducer(reducirIngesta, []);

  const indexar = useCallback(
    (origen: string, clase: 'fichero' | 'url') => {
      const limpio = origen.trim();
      if (!limpio) return;

      const id = crypto.randomUUID();
      despachar({ tipo: 'encolar', id, origen: limpio, clase });

      void (async () => {
        despachar({ tipo: 'empezar', id });
        try {
          const resultado =
            clase === 'url' ? await indexarUrl(limpio) : await indexarFichero(limpio);
          despachar({ tipo: 'hecho', id, fragmentos: resultado.num_chunks });
          alTerminar();
        } catch (error) {
          const estado = error instanceof ErrorApi ? error.estado : undefined;
          despachar({
            tipo: 'fallo',
            id,
            mensaje: mensajeDeIngesta(estado, mensajeDeError(error)),
          });
          // Un 409 significa que ya está en la lista: merece recargarla igual.
          if (estado === 409) alTerminar();
        }
      })();
    },
    [alTerminar],
  );

  const subir = useCallback(
    (ficheros: File[]) => {
      for (const fichero of ficheros) {
        const id = crypto.randomUUID();
        despachar({ tipo: 'encolar', id, origen: fichero.name, clase: 'subida' });

        void (async () => {
          despachar({ tipo: 'empezar', id });
          try {
            const resultado = await subirFichero(fichero);
            despachar({ tipo: 'hecho', id, fragmentos: resultado.num_chunks });
            alTerminar();
          } catch (error) {
            const estado = error instanceof ErrorApi ? error.estado : undefined;
            despachar({
              tipo: 'fallo',
              id,
              mensaje: mensajeDeIngesta(estado, mensajeDeError(error)),
            });
            if (estado === 409) alTerminar();
          }
        })();
      }
    },
    [alTerminar],
  );

  const olvidar = useCallback((id: string) => despachar({ tipo: 'olvidar', id }), []);

  return { trabajos, indexar, subir, olvidar };
}
