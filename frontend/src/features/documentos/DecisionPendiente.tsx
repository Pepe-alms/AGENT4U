import { BookOpen } from 'lucide-react';

import { ACCIONES, textoParecido } from '@/features/documentos/deduplicacion';
import type { AccionResolver, DocumentoRelacionado } from '@/shared/api/types';
import { Button } from '@/shared/ui';

type Props = {
  /** El documento indexado con el que se parece. Puede faltar si se borró. */
  antiguo: DocumentoRelacionado | undefined;
  pctNuevoEnAntiguo: number | null | undefined;
  pctAntiguoEnNuevo: number | null | undefined;
  onAbrir?: (id: number) => void;
  onResolver: (accion: AccionResolver) => void;
};

/**
 * Un documento casi igual a otro, esperando a que el usuario decida.
 *
 * Las tres acciones van siempre juntas y ninguna es la de por defecto: dos
 * documentos casi idénticos pueden ser distintos de verdad (dos facturas con
 * otro importe), y el sistema no elige por el usuario.
 */
export function DecisionPendiente({
  antiguo,
  pctNuevoEnAntiguo,
  pctAntiguoEnNuevo,
  onAbrir,
  onResolver,
}: Props) {
  const nombre = antiguo?.name ?? 'otro documento';
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.75rem] text-suave">
        {textoParecido(nombre, pctNuevoEnAntiguo, pctAntiguoEnNuevo)}
      </p>
      {antiguo && onAbrir && antiguo.state === 'indexado' ? (
        <button
          type="button"
          onClick={() => onAbrir(antiguo.id)}
          className="inline-flex items-center gap-1.5 self-start text-[0.75rem] font-medium text-suave underline-offset-2 hover:text-texto hover:underline"
        >
          <BookOpen size={12} aria-hidden="true" />
          Ver {antiguo.name}
        </button>
      ) : null}
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={`Qué hacer con este documento`}
      >
        {ACCIONES.map(({ accion, etiqueta, ayuda }) => (
          <Button
            key={accion}
            variante="secundario"
            tamano="sm"
            title={ayuda}
            onClick={() => onResolver(accion)}
          >
            {etiqueta}
          </Button>
        ))}
      </div>
    </div>
  );
}
