const FORMATO_LARGO = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'long',
  timeStyle: 'short',
});

/**
 * El backend manda ISO-8601 sin zona horaria (`2026-09-28T11:04:21.118000`),
 * que el navegador interpreta como hora local. Si la cadena no es una fecha
 * válida se devuelve tal cual, para no pintar "Invalid Date" al usuario.
 */
export function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return FORMATO_LARGO.format(fecha);
}

/** Las etiquetas van de lo más reciente a lo más antiguo. */
export const GRUPOS = ['Hoy', 'Ayer', 'Últimos 7 días', 'Anteriores'] as const;

export type Grupo = (typeof GRUPOS)[number];

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * A qué grupo pertenece una fecha, comparando **días de calendario** y no
 * diferencias de horas: algo de anoche a las 23:50 es "Ayer" aunque hayan
 * pasado veinte minutos, que es como lo lee una persona.
 */
export function grupoDeFecha(iso: string, ahora = new Date()): Grupo {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return 'Anteriores';

  const aMedianoche = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((aMedianoche(ahora) - aMedianoche(fecha)) / DIA_MS);

  // Una fecha futura (reloj desajustado) se trata como de hoy: es menos raro
  // que verla bajo "Anteriores".
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  if (dias < 7) return 'Últimos 7 días';
  return 'Anteriores';
}

/**
 * Reparte en grupos conservando el orden de entrada dentro de cada uno, y
 * devuelve solo los grupos que tienen algo: una cabecera vacía es ruido.
 */
export function agruparPorFecha<T>(
  elementos: T[],
  fechaDe: (elemento: T) => string,
  ahora = new Date(),
): Array<{ grupo: Grupo; elementos: T[] }> {
  const cajones = new Map<Grupo, T[]>();

  for (const elemento of elementos) {
    const grupo = grupoDeFecha(fechaDe(elemento), ahora);
    const cajon = cajones.get(grupo);
    if (cajon) cajon.push(elemento);
    else cajones.set(grupo, [elemento]);
  }

  return GRUPOS.filter((g) => cajones.has(g)).map((grupo) => ({
    grupo,
    elementos: cajones.get(grupo) ?? [],
  }));
}

const SOLO_HORA = new Intl.DateTimeFormat('es-ES', { timeStyle: 'short' });
const DIA_Y_MES = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const CON_ANO = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * La fecha como la escribiria una persona al final de una fila estrecha: la
 * hora si es de hoy, el dia y el mes si es de este año, y el año solo cuando
 * hace falta para no confundirse. "5 de octubre de 2026 a las 19:43" ocupa dos
 * lineas en una lista densa y no aporta nada que no diga "19:43".
 */
export function fechaCorta(iso: string, ahora = new Date()): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';

  const grupo = grupoDeFecha(iso, ahora);
  if (grupo === 'Hoy') return SOLO_HORA.format(fecha);
  if (grupo === 'Ayer') return 'ayer';
  if (fecha.getFullYear() === ahora.getFullYear()) return DIA_Y_MES.format(fecha);
  return CON_ANO.format(fecha);
}
