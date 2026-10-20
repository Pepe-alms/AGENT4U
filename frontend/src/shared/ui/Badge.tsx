import type { ReactNode } from 'react';

type Props = {
  tono?: 'neutro' | 'acento' | 'exito' | 'error' | 'aviso';
  children: ReactNode;
};

const TONO = {
  neutro: 'border-borde bg-superficie-suave text-suave',
  acento: 'border-acento/40 bg-acento-suave text-acento',
  exito: 'border-exito-borde bg-exito-fondo text-exito',
  error: 'border-error-borde bg-error-fondo text-error',
  aviso: 'border-aviso-borde bg-aviso-fondo text-aviso',
} as const;

export function Badge({ tono = 'neutro', children }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium ${TONO[tono]}`}
    >
      {children}
    </span>
  );
}
