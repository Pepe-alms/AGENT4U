import type { CSSProperties } from 'react';

import { Button } from '@/shared/ui/Button';

/* Solo texto: la guia de estilo es explicita en que no se meten iconos
   dentro de botones ni enlaces. Son chips de accion rapida, igual que los que
   OpenAI pone bajo su campo de busqueda. */
const EJEMPLOS = [
  '¿Qué dice el teorema CAP?',
  'Resume el capítulo de índices invertidos',
  'Compara B-trees con LSM-trees',
];

type Props = {
  backendCaido: boolean;
  /** null mientras no se sabe: no se afirma nada hasta tener el dato. */
  hayDocumentos: boolean | null;
  onPreguntar: (pregunta: string) => void;
  onVerDocumentos: () => void;
};

/**
 * Pantalla de arranque del chat. Tiene tres caras, y ninguna es una pantalla
 * en blanco: backend caido, sin documentos indexados, y lista para preguntar.
 */
export function Bienvenida({
  backendCaido,
  hayDocumentos,
  onPreguntar,
  onVerDocumentos,
}: Props) {
  if (backendCaido) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-[clamp(2rem,1.3rem+2.8vw,3rem)] font-medium">
          No hay <span className="texto-marca">conexión</span>
        </h1>
        <p className="max-w-[48ch] text-[1.0625rem] text-balance text-suave">
          El backend no responde, así que no se puede preguntar todavía. Arráncalo con{' '}
          <code className="rounded-s bg-superficie-suave px-1.5 py-0.5 font-mono text-[0.875rem]">
            uvicorn app.api.main:app --reload
          </code>{' '}
          desde la carpeta{' '}
          <code className="rounded-s bg-superficie-suave px-1.5 py-0.5 font-mono text-[0.875rem]">
            backend/
          </code>
          ; la conexión se reintenta sola cada 30 segundos.
        </p>
      </div>
    );
  }

  if (hayDocumentos === false) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-[clamp(2rem,1.3rem+2.8vw,3rem)] font-medium">
          Aún no hay nada <span className="texto-marca">indexado</span>
        </h1>
        <p className="max-w-[48ch] text-[1.0625rem] text-balance text-suave">
          El agente responde a partir de tus documentos, y ahora mismo no hay ninguno.
          Indexa el primero y podrás preguntarle por su contenido.
        </p>
        <Button onClick={onVerDocumentos}>Indexar un documento</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-[clamp(2rem,1.3rem+2.8vw,3rem)] font-medium">
          Pregunta a tus <span className="texto-marca">documentos</span>
        </h1>
        <p className="max-w-[48ch] text-[1.0625rem] text-balance text-suave">
          Respuestas con citas, trazadas hasta el fragmento exacto del que salen.
        </p>
      </div>

      {/* Las sugerencias van DEBAJO del campo, no encima: lo que se viene a
          hacer es escribir, y son una ayuda por si no se sabe por donde. */}
      <ul className="flex flex-wrap justify-center gap-2">
        {EJEMPLOS.map((pregunta, indice) => (
          <li
            key={pregunta}
            className="entra"
            style={{ '--indice': indice } as CSSProperties}
          >
            <button
              type="button"
              onClick={() => onPreguntar(pregunta)}
              className="rounded-full border border-borde px-5 py-2 text-[0.875rem] font-medium text-texto transition-colors hover:bg-superficie-suave"
            >
              {pregunta}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
