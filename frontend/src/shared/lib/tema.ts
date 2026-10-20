import { guardarEnAlmacen, leerDelAlmacen } from '@/shared/lib/almacen';

export type Tema = 'claro' | 'oscuro' | 'sistema';

const CLAVE = 'agent4u:tema';

function esTema(valor: unknown): valor is Tema {
  return valor === 'claro' || valor === 'oscuro' || valor === 'sistema';
}

/**
 * Sin nada guardado se entra en el tema claro, que es el crema: ahi esta la
 * identidad del producto. Dejarlo detras de un interruptor significaria que
 * casi nadie lo ve. El oscuro es tinta tostada, la misma idea invertida, y
 * quien prefiera seguir al sistema lo elige y entonces si se respeta.
 */
export function leerTemaGuardado(): Tema {
  const guardado = leerDelAlmacen(CLAVE);
  return esTema(guardado) ? guardado : 'claro';
}

export function guardarTema(tema: Tema): void {
  guardarEnAlmacen(CLAVE, tema);
}

/**
 * 'sistema' quita el atributo para que mande la media query
 * `prefers-color-scheme` de tokens.css.
 */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === 'sistema') {
    raiz.removeAttribute('data-tema');
  } else {
    raiz.setAttribute('data-tema', tema);
  }
}

/** El boton alterna entre los dos temas reales; 'sistema' se elige desde
 *  los ajustes o la paleta, que es donde se entiende lo que significa. */
export const SIGUIENTE_TEMA: Record<Tema, Tema> = {
  sistema: 'claro',
  claro: 'oscuro',
  oscuro: 'claro',
};

/** Nombre corto para un selector. El de abajo es una frase para el tooltip. */
export const NOMBRE_TEMA: Record<Tema, string> = {
  sistema: 'Sistema',
  claro: 'Claro',
  oscuro: 'Oscuro',
};
