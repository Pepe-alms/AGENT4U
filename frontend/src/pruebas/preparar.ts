// Matchers que comprueban lo que el navegador CALCULA (estado deshabilitado,
// nombre accesible, valor), no el atributo escrito: hacerlo a mano sería
// repetir esa lógica y equivocarse.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Desmonta lo renderizado entre pruebas. Sin esto, cada test ve los nodos de
// los anteriores y las consultas por texto empiezan a encontrar de más.
afterEach(cleanup);

// jsdom no trae estas dos, y los componentes las usan de verdad.
if (!window.matchMedia) {
  window.matchMedia = (consulta: string) =>
    ({
      matches: false,
      media: consulta,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom no hace scroll, así que tampoco trae esto. Los componentes lo usan
// para traer a la vista la opción activa.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

if (!HTMLDialogElement.prototype.showModal) {
  // jsdom no implementa <dialog>: se simula lo justo para poder comprobar
  // que se abre y se cierra, no su comportamiento modal.
  HTMLDialogElement.prototype.showModal = function abrir(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function cerrar(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}
