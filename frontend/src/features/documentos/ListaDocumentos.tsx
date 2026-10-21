import { useState } from 'react';

import { Trash2 } from 'lucide-react';

import { eliminarDocumento } from '@/shared/api/documentos';
import { mensajeDeError } from '@/shared/api/errores';
import type { Documento, EstadoDocumento } from '@/shared/api/types';
import type { EstadoRecurso } from '@/shared/hooks/useRecurso';
import { Badge, Button, IconButton, Skeleton, Spinner } from '@/shared/ui';

const TONO: Record<EstadoDocumento, 'exito' | 'aviso' | 'error'> = {
  'en-cola': 'aviso',
  indexando: 'aviso',
  pendiente: 'aviso',
  indexado: 'exito',
  error: 'error',
};

type Props = {
  estado: EstadoRecurso<Documento[]>;
  reintentar: () => void;
  /** Se llama cuando un borrado cambia la lista. */
  alCambiar: () => void;
  /** Confirma al usuario lo que acaba de pasar: toast + anuncio. */
  onAvisar: (texto: string, tono?: 'exito' | 'error') => void;
};

/** Presentacional en cuanto a la carga: la petición de la lista la hace App. */
export function ListaDocumentos({ estado, reintentar, alCambiar, onAvisar }: Props) {
  const [borrando, setBorrando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  async function borrar(documento: Documento) {
    setBorrando(documento.name);
    setFallo(null);
    try {
      // Dos desenlaces con código 200: hay que mirar `status`, no el código.
      // Contrato: backend/app/api/schemas.py:153
      const resultado = await eliminarDocumento(documento.name);
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
            className="group/doc flex items-center gap-2 rounded-s px-2 py-1.5 transition-colors hover:bg-superficie-hover"
          >
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
              <Badge tono={TONO[documento.state]}>{documento.state}</Badge>
            )}
            {borrando === documento.name ? (
              <Spinner tamano="sm" etiqueta={`Borrando ${documento.name}`} />
            ) : (
              <IconButton
                etiqueta={`Borrar ${documento.name}`}
                icono={<Trash2 size={14} />}
                onClick={() => void borrar(documento)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
