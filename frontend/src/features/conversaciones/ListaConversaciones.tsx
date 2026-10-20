import { useState, type CSSProperties } from 'react';

import { Pencil, Trash2 } from 'lucide-react';

import { eliminarConversacion, renombrarConversacion } from '@/shared/api/conversaciones';
import { mensajeDeError } from '@/shared/api/errores';
import type { EstadoRecurso } from '@/shared/hooks/useRecurso';
import type { ConversacionResumen } from '@/shared/api/types';
import { agruparPorFecha, fechaCorta, formatearFecha } from '@/shared/lib/fechas';
import { Button, IconButton, Skeleton } from '@/shared/ui';
import { TituloEditable } from '@/features/conversaciones/TituloEditable';

type Props = {
  /** La peticion la hace App: la paleta de comandos busca en la misma lista. */
  estado: EstadoRecurso<ConversacionResumen[]>;
  recargar: () => void;
  /** Hilo abierto ahora mismo, para marcarlo en la lista. */
  activa: number | null;
  onAbrir: (id: number) => void;
  /** Se avisa cuando se borra el hilo abierto: el chat tiene que vaciarse. */
  onBorrarActiva: () => void;
  /** Confirma al usuario lo que acaba de pasar: toast + anuncio. */
  onAvisar: (texto: string, tono?: 'exito' | 'error') => void;
};

/**
 * Lista densa: una fila por conversacion, una sola linea, titulo truncado y la
 * fecha corta al final. Antes cada fila eran dos lineas de titulo mas dos de
 * fecha completa ("5 de octubre de 2026 a las 19:43"), unos 145px por
 * conversacion: cabian cuatro en una pantalla de portatil.
 */
export function ListaConversaciones({
  estado,
  recargar,
  activa,
  onAbrir,
  onBorrarActiva,
  onAvisar,
}: Props) {
  const [borrando, setBorrando] = useState<number | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  async function renombrar(id: number, titulo: string) {
    setEditando(null);
    setFallo(null);
    try {
      await renombrarConversacion(id, titulo);
      recargar();
      onAvisar('Conversación renombrada.');
    } catch (error) {
      setFallo(mensajeDeError(error));
      onAvisar('No se pudo renombrar.', 'error');
    }
  }

  async function borrar(id: number) {
    setBorrando(id);
    setFallo(null);
    try {
      await eliminarConversacion(id);
      if (id === activa) onBorrarActiva();
      recargar();
      onAvisar('Conversación borrada.');
    } catch (error) {
      setFallo(mensajeDeError(error));
      onAvisar('No se pudo borrar la conversación.', 'error');
    } finally {
      setBorrando(null);
    }
  }

  if (estado.fase === 'cargando') {
    return (
      <div className="flex flex-col gap-1" aria-busy="true" aria-live="polite">
        <span className="solo-lectores">Cargando conversaciones</span>
        {[0, 1, 2, 3, 4].map((fila) => (
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
        <Button variante="secundario" tamano="sm" onClick={recargar}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (estado.datos.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-sm text-balance text-tenue">
        Todavía no hay conversaciones.
        <br />
        La primera pregunta que hagas abrirá una.
      </p>
    );
  }

  // El backend ya las manda por `actualizada_en` descendente, asi que agrupar
  // conservando el orden basta: no hace falta volver a ordenar.
  const grupos = agruparPorFecha(estado.datos, (c) => c.actualizada_en);
  let posicion = 0;

  return (
    <div className="flex flex-col gap-4">
      {fallo ? (
        <p
          className="rounded-m border border-error-borde bg-error-fondo p-2 text-sm text-error"
          role="alert"
        >
          {fallo}
        </p>
      ) : null}

      {grupos.map(({ grupo, elementos }) => (
        <section key={grupo} className="flex flex-col gap-0.5">
          <h3 className="etiqueta-seccion px-2 pb-1">{grupo}</h3>
          <ul className="flex flex-col gap-px">
            {elementos.map((conversacion) => {
              const esActiva = conversacion.id === activa;
              // --indice alimenta el retraso de la animacion de entrada; se
              // cuenta sobre la lista entera, no por grupo, o las cabeceras
              // reiniciarian la cascada.
              const indice = posicion++;

              if (editando === conversacion.id) {
                return (
                  <li key={conversacion.id} className="px-1">
                    <TituloEditable
                      titulo={conversacion.titulo}
                      onGuardar={(titulo) => void renombrar(conversacion.id, titulo)}
                      onCancelar={() => setEditando(null)}
                    />
                  </li>
                );
              }

              return (
                <li
                  key={conversacion.id}
                  className="entra group/fila relative"
                  style={{ '--indice': indice } as CSSProperties}
                >
                  <button
                    type="button"
                    aria-current={esActiva ? 'true' : undefined}
                    onClick={() => onAbrir(conversacion.id)}
                    /* Doble clic para renombrar, como en un gestor de
                       ficheros. El boton de al lado hace lo mismo para quien
                       no use raton. */
                    onDoubleClick={() => setEditando(conversacion.id)}
                    title={conversacion.titulo}
                    className={[
                      'flex w-full items-center gap-2 rounded-m py-2 ps-2.5 pe-16 text-start text-sm',
                      'transition-colors duration-150',
                      // El hilo abierto se marca con el tinte de superficie y
                      // el texto en peso medio. Sin color de marca, el estado
                      // se dice con peso y fondo.
                      esActiva
                        ? 'bg-superficie-suave font-medium text-texto'
                        : 'text-suave hover:bg-superficie-suave hover:text-texto',
                    ].join(' ')}
                  >
                    {/* La barra de la conversacion activa, en el color del
                        texto: no hay color de marca con el que pintarla. */}
                    <span
                      className={[
                        'h-4 w-0.5 shrink-0 rounded-full transition-opacity',
                        esActiva ? 'bg-texto opacity-100' : 'opacity-0',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{conversacion.titulo}</span>
                    <time
                      className="tabular shrink-0 font-mono text-[0.6875rem] text-tenue group-hover/fila:opacity-0"
                      dateTime={conversacion.actualizada_en}
                      title={formatearFecha(conversacion.actualizada_en)}
                    >
                      {fechaCorta(conversacion.actualizada_en)}
                    </time>
                  </button>

                  {/*
                    Las acciones van superpuestas y no en el flujo: dentro de la
                    fila meterian un boton dentro de otro, que es HTML invalido
                    y rompe la tabulacion. Ocultas hasta el hover, pero visibles
                    con el foco: si no, no se llega a ellas con el teclado.
                  */}
                  <div className="absolute end-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/fila:opacity-100 focus-within:opacity-100">
                    <IconButton
                      etiqueta={`Renombrar la conversación ${conversacion.titulo}`}
                      icono={<Pencil size={13} />}
                      onClick={() => setEditando(conversacion.id)}
                    />
                    <IconButton
                      etiqueta={`Borrar la conversación ${conversacion.titulo}`}
                      icono={<Trash2 size={13} />}
                      disabled={borrando === conversacion.id}
                      onClick={() => void borrar(conversacion.id)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
