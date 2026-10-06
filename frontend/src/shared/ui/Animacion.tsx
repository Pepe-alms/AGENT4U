import type { ReactNode } from 'react';

import { LazyMotion, MotionConfig } from 'motion/react';

/**
 * Proveedor del motor de animacion de Motion.
 *
 * Hace falta porque los componentes se importan de `motion/react-m`, que da
 * `m.div` y compañia **sin** el motor: sin este proveedor no animan. A cambio
 * se evita la fabrica completa de `motion.*`, y eso si se nota.
 *
 * Medido sobre el build: 124,4 -> 110,7 kB gz. El resto de Motion (~34 kB gz
 * sobre los 76 que habia antes de la migracion) no se puede separar: el motor
 * (`domAnimation`) vive en el mismo modulo que `AnimatePresence` y
 * `LazyMotion`, asi que la carga diferida no llega a cortar nada. Se intento y
 * el empaquetador lo dijo con un INEFFECTIVE_DYNAMIC_IMPORT.
 *
 * Si algun dia molestasen esos 34 kB, la salida no es pelearse con Motion sino
 * quitarlo: las tres animaciones que lo usan (dos anchos de panel y un alto
 * automatico) se pueden hacer con CSS moderno —`interpolate-size`,
 * `@starting-style` y `transition-behavior: allow-discrete`—, a cambio de
 * perder la animacion de salida en los navegadores que aun no lo soportan.
 */
export function Animacion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={() => import('motion/react').then((mod) => mod.domAnimation)}>
      {/*
        `reducedMotion="user"` es la red de seguridad: Motion desactiva solo
        las animaciones de transformada cuando el sistema lo pide, sin que cada
        componente tenga que acordarse. Los que ademas deben quedarse en su
        estado final de golpe —Revelar, el pulso del pipeline— lo resuelven por
        su cuenta con `useReducedMotion`.
      */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
