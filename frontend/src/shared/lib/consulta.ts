import { guardarEnAlmacen, leerDelAlmacen } from '@/shared/lib/almacen';

/** Lo que el usuario elige para sus consultas. `null` = lo que diga el servidor. */
export type AjustesConsulta = {
  maxFragmentos: number | null;
  modelo: string | null;
};

const CLAVE = 'agent4u:consulta';

const CONSULTA_POR_DEFECTO: AjustesConsulta = {
  maxFragmentos: null,
  modelo: null,
};

/**
 * Se guarda lo que el usuario eligio, no lo que vale ahora mismo. Si guardase
 * el valor efectivo, cambiar el defecto del servidor no le afectaria nunca: lo
 * tendria congelado sin haberlo pedido.
 */
export function leerAjustesConsulta(): AjustesConsulta {
  const guardado = leerDelAlmacen(CLAVE);
  if (!guardado) return CONSULTA_POR_DEFECTO;

  try {
    const valor: unknown = JSON.parse(guardado);
    if (typeof valor !== 'object' || valor === null) return CONSULTA_POR_DEFECTO;

    const { maxFragmentos, modelo } = valor as Partial<AjustesConsulta>;
    return {
      maxFragmentos: typeof maxFragmentos === 'number' ? maxFragmentos : null,
      modelo: typeof modelo === 'string' ? modelo : null,
    };
  } catch {
    return CONSULTA_POR_DEFECTO;
  }
}

export function guardarAjustesConsulta(ajustes: AjustesConsulta): void {
  guardarEnAlmacen(CLAVE, JSON.stringify(ajustes));
}
