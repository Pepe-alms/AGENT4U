import { useEffect, useState } from 'react';

import { comprobarSalud, type Salud } from '@/shared/api/salud';

/** 30 s: suficiente para enterarse de una caida sin castigar al backend. */
const INTERVALO_MS = 30_000;

const INICIAL: Salud = { backend: 'ok', qdrant: 'desconocido' };

export function useSalud(): { salud: Salud; comprobando: boolean } {
  const [salud, setSalud] = useState<Salud>(INICIAL);
  const [comprobando, setComprobando] = useState(true);

  useEffect(() => {
    const control = new AbortController();
    let vivo = true;

    async function comprobar() {
      const resultado = await comprobarSalud({ signal: control.signal });
      if (!vivo) return;
      setSalud(resultado);
      setComprobando(false);
    }

    void comprobar();
    const temporizador = setInterval(() => void comprobar(), INTERVALO_MS);

    return () => {
      vivo = false;
      clearInterval(temporizador);
      control.abort();
    };
  }, []);

  return { salud, comprobando };
}
