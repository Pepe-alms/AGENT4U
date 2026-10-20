import { useCallback, useEffect, useState } from 'react';

import {
  aplicarDensidad,
  guardarDensidad,
  leerDensidadGuardada,
  type Densidad,
} from '@/shared/lib/densidad';
import {
  guardarAjustesConsulta,
  leerAjustesConsulta,
  type AjustesConsulta,
} from '@/shared/lib/consulta';
import { aplicarTema, guardarTema, leerTemaGuardado, type Tema } from '@/shared/lib/tema';

export type Preferencias = {
  tema: Tema;
  densidad: Densidad;
  consulta: AjustesConsulta;
  elegirTema: (tema: Tema) => void;
  elegirDensidad: (densidad: Densidad) => void;
  elegirConsulta: (consulta: AjustesConsulta) => void;
};

/**
 * Las dos preferencias juntas, porque las dos hacen lo mismo: se leen al
 * arrancar, se aplican al `<html>` y se guardan. El valor inicial sale del
 * almacen en el propio `useState`, no de un efecto, para que no haya un primer
 * render con el ajuste equivocado.
 */
export function usePreferencias(): Preferencias {
  const [tema, setTema] = useState<Tema>(leerTemaGuardado);
  const [densidad, setDensidad] = useState<Densidad>(leerDensidadGuardada);
  const [consulta, setConsulta] = useState<AjustesConsulta>(leerAjustesConsulta);

  useEffect(() => {
    aplicarTema(tema);
    guardarTema(tema);
  }, [tema]);

  useEffect(() => {
    aplicarDensidad(densidad);
    guardarDensidad(densidad);
  }, [densidad]);

  useEffect(() => {
    guardarAjustesConsulta(consulta);
  }, [consulta]);

  return {
    tema,
    densidad,
    consulta,
    elegirTema: useCallback((nuevo: Tema) => setTema(nuevo), []),
    elegirDensidad: useCallback((nueva: Densidad) => setDensidad(nueva), []),
    elegirConsulta: useCallback((nueva: AjustesConsulta) => setConsulta(nueva), []),
  };
}
