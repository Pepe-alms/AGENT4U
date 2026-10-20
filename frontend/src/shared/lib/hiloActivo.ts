import { guardarEnAlmacen, leerDelAlmacen } from '@/shared/lib/almacen';

const CLAVE = 'agent4u:hilo';

/**
 * Recuerda que hilo estaba abierto para poder reabrirlo al recargar.
 *
 * Solo se guarda el **id**: los mensajes vienen del backend, que es quien los
 * tiene de verdad. Guardar una copia aqui seria inventarse una segunda fuente
 * de verdad que se desincronizaria en cuanto se borrase la conversacion.
 */
export function leerHiloActivo(): number | null {
  const guardado = Number(leerDelAlmacen(CLAVE));
  return Number.isInteger(guardado) && guardado > 0 ? guardado : null;
}

export function guardarHiloActivo(id: number | null): void {
  guardarEnAlmacen(CLAVE, id === null ? null : String(id));
}
