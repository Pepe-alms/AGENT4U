import { useEffect } from 'react';

import { useLocation } from 'react-router';

/**
 * Lleva al ancla del hash cuando la pagina ya esta montada.
 *
 * Va en CADA PAGINA y no en el layout, y ese es todo el truco: el layout se
 * monta antes de que el `Suspense` resuelva el paquete de la pagina, asi que
 * cuando su efecto corre el ancla todavia no existe en el DOM.
 *
 * La version anterior lo resolvia reintentando durante 500ms con
 * `requestAnimationFrame`, que funcionaba pero era adivinar: con una CPU lenta
 * o un paquete grande se podia agotar el plazo sin haber encontrado nada, y no
 * habia forma de saberlo sin probarlo. Llamandolo desde el efecto de la
 * pagina, el elemento esta garantizado y sobra el reintento.
 *
 * Si el ancla no existe no hace nada: un hash hacia un id que no esta es un
 * enlace mal escrito, y saltar a otro sitio seria peor que quedarse quieto.
 */
export function useScrollToHash() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;

    const destino = document.querySelector(hash);
    if (!destino) return;

    const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    destino.scrollIntoView({
      behavior: sinMovimiento ? 'auto' : 'smooth',
      block: 'start',
    });
  }, [hash]);
}
