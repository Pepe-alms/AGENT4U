import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { obtenerAjustesServidor } from '@/shared/api/ajustes';
import {
  indexarFichero,
  indexarUrl,
  obtenerEstadoTrabajo,
  resolverDocumento,
  subirFichero,
} from '@/shared/api/documentos';
import { ErrorApi, mensajeDeError, mismoFicheroQue } from '@/shared/api/errores';
import type { AccionResolver } from '@/shared/api/types';
import { useRecurso } from '@/shared/hooks/useRecurso';
import {
  huecosLibres,
  MAX_EN_VUELO_PROVISIONAL,
  mensajeDeIngesta,
  reducirIngesta,
  repartir,
  type Trabajo,
} from '@/features/documentos/ingesta';

const SIN_HUECO =
  'El servidor solo acepta unas pocas indexaciones a la vez. Espera a que ' +
  'terminen las que hay en marcha.';

const POLL_MS = 5_000;
const POLL_PRIMER_MS = 500;

export type Ingesta = {
  trabajos: Trabajo[];
  indexar: (origen: string, clase: 'fichero' | 'url') => void;
  /**
   * Sube los ficheros y los indexa. Manda solo los que caben y devuelve los
   * que no, para que quien llama pueda decirlo.
   */
  subir: (ficheros: File[]) => File[];
  olvidar: (id: string) => void;
  /**
   * La decisión del usuario sobre un documento pendiente de decisión. Sirve
   * igual desde la cola que desde la lista: si no estaba en la cola, se
   * añade para seguir su indexación.
   */
  resolver: (documentoId: number, nombre: string, accion: AccionResolver) => void;
  /** Cuántos trabajos más acepta el servidor ahora mismo. */
  huecos: number;
  /** El techo del servidor, para poder enseñar «2 de 5». */
  maxEnVuelo: number;
};

/**
 * Lanza indexaciones y lleva la cuenta de cada una por separado.
 *
 * `alTerminar` lo usa quien monta esto para recargar la lista de documentos:
 * el hook no sabe nada de esa lista, solo avisa de que algo ha cambiado.
 */
export function useIngesta(alTerminar: () => void): Ingesta {
  const [trabajos, despachar] = useReducer(reducirIngesta, []);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const alTerminarRef = useRef(alTerminar);

  useEffect(() => {
    alTerminarRef.current = alTerminar;
  });

  useEffect(() => {
    const mapa = timers.current;
    return () => {
      for (const t of mapa.values()) clearTimeout(t);
      mapa.clear();
    };
  }, []);

  const { estado: ajustes } = useRecurso(obtenerAjustesServidor);
  const maxEnVuelo =
    ajustes.fase === 'listo'
      ? ajustes.datos.max_indexaciones_en_vuelo
      : MAX_EN_VUELO_PROVISIONAL;

  const huecos = useMemo(
    () => huecosLibres(trabajos, maxEnVuelo),
    [trabajos, maxEnVuelo],
  );

  const pollear = useCallback((id: string, jobId: string) => {
    const comprobar = async () => {
      if (!timers.current.has(id)) return;
      try {
        const estado = await obtenerEstadoTrabajo(jobId);
        if (estado.status === 'indexado') {
          timers.current.delete(id);
          despachar({ tipo: 'hecho', id, fragmentos: estado.num_chunks });
          alTerminarRef.current();
          return;
        }
        if (estado.status === 'error') {
          timers.current.delete(id);
          despachar({
            tipo: 'fallo',
            id,
            mensaje: estado.error_message ?? 'La indexación falló.',
          });
          return;
        }
        // Los dos desenlaces de la deduplicacion que se ven tras convertir:
        // son finales, como indexado o error. Sin esto, el sondeo seguiria
        // para siempre esperando un 'indexado' que no va a llegar.
        if (estado.status === 'duplicado' && estado.documento_id !== null) {
          timers.current.delete(id);
          despachar({
            tipo: 'duplicado',
            id,
            documentoId: estado.documento_id,
            relacionado: estado.relacionado ?? undefined,
          });
          alTerminarRef.current();
          return;
        }
        if (estado.status === 'pendiente-decision' && estado.documento_id !== null) {
          timers.current.delete(id);
          despachar({
            tipo: 'pendiente',
            id,
            documentoId: estado.documento_id,
            relacionado: estado.relacionado ?? undefined,
            pctNuevoEnAntiguo: estado.pct_nuevo_en_antiguo,
            pctAntiguoEnNuevo: estado.pct_antiguo_en_nuevo,
          });
          alTerminarRef.current();
          return;
        }
        if (estado.status === 'indexando') {
          despachar({ tipo: 'empezar', id });
        }
      } catch {
        // Error de red durante el sondeo: se reintenta en el siguiente ciclo.
      }
      timers.current.set(id, setTimeout(comprobar, POLL_MS));
    };
    timers.current.set(id, setTimeout(comprobar, POLL_PRIMER_MS));
  }, []);

  /** Un fallo al mandar: el rechazo del nivel 1 se cuenta aparte. */
  const rechazarOFallar = useCallback((id: string, error: unknown) => {
    const original = mismoFicheroQue(error);
    if (original) {
      despachar({ tipo: 'rechazado', id, relacionado: original });
      return;
    }
    const estado = error instanceof ErrorApi ? error.estado : undefined;
    despachar({
      tipo: 'fallo',
      id,
      mensaje: mensajeDeIngesta(estado, mensajeDeError(error)),
    });
    if (estado === 409) alTerminarRef.current();
  }, []);

  const indexar = useCallback(
    (origen: string, clase: 'fichero' | 'url') => {
      const limpio = origen.trim();
      if (!limpio) return;

      const id = crypto.randomUUID();
      despachar({ tipo: 'encolar', id, origen: limpio, clase });

      if (huecos === 0) {
        despachar({ tipo: 'fallo', id, mensaje: SIN_HUECO });
        return;
      }

      void (async () => {
        try {
          const resultado =
            clase === 'url' ? await indexarUrl(limpio) : await indexarFichero(limpio);
          pollear(id, resultado.job_id);
        } catch (error) {
          rechazarOFallar(id, error);
        }
      })();
    },
    [huecos, pollear, rechazarOFallar],
  );

  const subir = useCallback(
    (ficheros: File[]): File[] => {
      const { caben, sobran } = repartir(ficheros, huecos);

      for (const fichero of caben) {
        const id = crypto.randomUUID();
        despachar({ tipo: 'encolar', id, origen: fichero.name, clase: 'subida' });

        void (async () => {
          try {
            const resultado = await subirFichero(fichero);
            pollear(id, resultado.job_id);
          } catch (error) {
            rechazarOFallar(id, error);
          }
        })();
      }

      return sobran;
    },
    [huecos, pollear, rechazarOFallar],
  );

  // La cola actual, leida desde `resolver` sin hacerla dependencia: asi
  // `resolver` no cambia de identidad con cada tic del sondeo.
  const trabajosRef = useRef(trabajos);
  useEffect(() => {
    trabajosRef.current = trabajos;
  });

  const resolver = useCallback(
    (documentoId: number, nombre: string, accion: AccionResolver) => {
      let id = trabajosRef.current.find((t) => t.documentoId === documentoId)?.id;
      if (!id) {
        id = crypto.randomUUID();
        despachar({ tipo: 'seguir', id, origen: nombre, documentoId });
      }
      const trabajo = id;

      void (async () => {
        try {
          const resultado = await resolverDocumento(documentoId, accion);
          if (resultado.status === 'descartado') {
            despachar({ tipo: 'descartado', id: trabajo });
          } else {
            despachar({ tipo: 'reencolar', id: trabajo });
            if (resultado.job_id) pollear(trabajo, resultado.job_id);
          }
          alTerminarRef.current();
        } catch (error) {
          const estado = error instanceof ErrorApi ? error.estado : undefined;
          despachar({
            tipo: 'fallo',
            id: trabajo,
            mensaje: mensajeDeIngesta(estado, mensajeDeError(error)),
          });
          alTerminarRef.current();
        }
      })();
    },
    [pollear],
  );

  const olvidar = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    despachar({ tipo: 'olvidar', id });
  }, []);

  return { trabajos, indexar, subir, olvidar, resolver, huecos, maxEnVuelo };
}
