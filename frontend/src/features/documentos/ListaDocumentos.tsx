import { useState } from 'react';

import { BookOpen, Trash2 } from 'lucide-react';

import { DecisionPendiente } from '@/features/documentos/DecisionPendiente';

import { eliminarDocumento } from '@/shared/api/documentos';
import { mensajeDeError } from '@/shared/api/errores';
import type {
  AccionResolver,
  Documento,
  DocumentoRelacionado,
  EstadoDocumento,
} from '@/shared/api/types';
import type { EstadoRecurso } from '@/shared/hooks/useRecurso';
import { Badge, Button, IconButton, Skeleton, Spinner } from '@/shared/ui';

const TONO: Record<EstadoDocumento, 'exito' | 'aviso' | 'error'> = {
  'en-cola': 'aviso',
  indexando: 'aviso',
  pendiente: 'aviso',
  indexado: 'exito',
  error: 'error',
  duplicado: 'aviso',
  'pendiente-decision': 'aviso',
};

/** El estado tal como se lee: "pendiente-decision" no le dice nada a nadie. */
const ETIQUETA: Partial<Record<EstadoDocumento, string>> = {
  'pendiente-decision': '¿nueva versión?',
};

type Props = {
  estado: EstadoRecurso<Documento[]>;
  reintentar: () => void;
  /** Se llama cuando un borrado cambia la lista. */
  alCambiar: () => void;
  /** Confirma al usuario lo que acaba de pasar: toast + anuncio. */
  onAvisar: (texto: string, tono?: 'exito' | 'error') => void;
  /** Abre el visor con el contenido del documento. */
  onLeer?: (documento: Documento) => void;
  /** Abre en el visor otro documento, por id: el original de un duplicado. */
  onAbrirDocumento?: (id: number) => void;
  /** Lo que el usuario decide con un documento pendiente de decisión. */
  onResolver?: (documento: Documento, accion: AccionResolver) => void;
};

/** Presentacional en cuanto a la carga: la petición de la lista la hace App. */
export function ListaDocumentos({
  estado,
  reintentar,
  alCambiar,
  onAvisar,
  onLeer,
  onAbrirDocumento,
  onResolver,
}: Props) {
  const [borrando, setBorrando] = useState<number | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  async function borrar(documento: Documento) {
    setBorrando(documento.id);
    setFallo(null);
    try {
      // Dos desenlaces con código 200: hay que mirar `status`, no el código.
      const resultado = await eliminarDocumento(documento.id);
      if (resultado.status === 'fallo en el borrado') {
        setFallo(`«${documento.name}» sigue ahí: Qdrant no pudo borrar sus vectores.`);
        onAvisar('No se pudo borrar el documento.', 'error');
      } else {
        onAvisar(`«${documento.name}» borrado.`);
      }
      alCambiar();
    } catch (error) {
      setFallo(mensajeDeError(error));
      onAvisar('No se pudo borrar el documento.', 'error');
    } finally {
      setBorrando(null);
    }
  }

  /** El otro documento de un desenlace, buscado en la propia lista. */
  function relacionado(id: number | null | undefined): DocumentoRelacionado | undefined {
    if (id == null || estado.fase !== 'listo') return undefined;
    const otro = estado.datos.find((d) => d.id === id);
    return otro ? { id: otro.id, name: otro.name, state: otro.state } : undefined;
  }

  if (estado.fase === 'cargando') {
    return (
      <div className="flex flex-col gap-1" aria-busy="true">
        <span className="solo-lectores">Cargando documentos</span>
        {[0, 1].map((fila) => (
          <Skeleton key={fila} alto="2rem" />
        ))}
      </div>
    );
  }

  if (estado.fase === 'error') {
    return (
      <div
        className="flex flex-col items-start gap-2 rounded-m border border-error-borde bg-error-fondo p-3 text-sm text-error"
        role="alert"
      >
        <p>{estado.mensaje}</p>
        <Button variante="secundario" tamano="sm" onClick={reintentar}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (estado.datos.length === 0) {
    return (
      <p className="rounded-m border border-dashed border-borde px-3 py-4 text-sm text-balance text-tenue">
        No hay ningún documento indexado. Sin documentos, el agente no tiene de dónde
        sacar las respuestas.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {fallo ? (
        <p
          className="rounded-m border border-error-borde bg-error-fondo p-2 text-sm text-error"
          role="alert"
        >
          {fallo}
        </p>
      ) : null}
      <ul className="flex flex-col gap-px">
        {estado.datos.map((documento) => (
          <li
            key={documento.id}
            className="group/doc flex flex-col gap-1.5 rounded-s px-2 py-1.5 transition-colors hover:bg-superficie-hover"
          >
            <div className="flex items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate font-mono text-[0.75rem] text-suave"
                title={documento.origin}
              >
                {documento.name}
              </span>
              {/* El estado solo se enseña cuando dice algo: marcar "indexado" en
                  todos los documentos es ruido. */}
              {documento.state === 'indexado' ? (
                <Badge tono="neutro">{documento.num_chunks} frag.</Badge>
              ) : (
                <Badge tono={TONO[documento.state]}>
                  {ETIQUETA[documento.state] ?? documento.state}
                </Badge>
              )}
              {/* Solo los indexados: los demas no tienen contenido que leer, y
                  el visor lo explicaria, pero ofrecer algo que no va a
                  funcionar es peor que no ofrecerlo. */}
              {onLeer && documento.state === 'indexado' ? (
                <IconButton
                  etiqueta={`Leer ${documento.name}`}
                  icono={<BookOpen size={14} />}
                  onClick={() => onLeer(documento)}
                />
              ) : null}
              {borrando === documento.id ? (
                <Spinner tamano="sm" etiqueta={`Borrando ${documento.name}`} />
              ) : (
                <IconButton
                  etiqueta={`Borrar ${documento.name}`}
                  icono={<Trash2 size={14} />}
                  onClick={() => void borrar(documento)}
                />
              )}
            </div>

            {documento.state === 'duplicado' ? (
              <Duplicado
                original={relacionado(documento.duplicado_de)}
                onAbrir={onAbrirDocumento}
              />
            ) : null}
            {documento.state === 'pendiente-decision' && onResolver ? (
              <DecisionPendiente
                antiguo={relacionado(documento.parecido_a)}
                pctNuevoEnAntiguo={documento.pct_nuevo_en_antiguo}
                pctAntiguoEnNuevo={documento.pct_antiguo_en_nuevo}
                onAbrir={onAbrirDocumento}
                onResolver={(accion) => onResolver(documento, accion)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mismo contenido que otro documento: no se indexó, y se dice cuál. */
function Duplicado({
  original,
  onAbrir,
}: {
  original: DocumentoRelacionado | undefined;
  onAbrir: ((id: number) => void) | undefined;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[0.75rem] text-suave">
      <span>
        No indexado: mismo contenido que{' '}
        <span className="font-mono">{original?.name ?? 'otro documento ya borrado'}</span>
        .
      </span>
      {original && onAbrir && original.state === 'indexado' ? (
        <button
          type="button"
          onClick={() => onAbrir(original.id)}
          className="font-medium underline-offset-2 hover:text-texto hover:underline"
        >
          Abrir original
        </button>
      ) : null}
    </p>
  );
}
