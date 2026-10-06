import { Cover, type FormaCover, type PaletaCover } from '@/sitio/componentes/Cover';
import { Revelar } from '@/sitio/componentes/Revelar';

/**
 * La cabecera comun a todas las paginas: eyebrow, titular, entradilla y una
 * portada grande a ancho completo. Repetirla identica en las nueve paginas es
 * lo que hace que el sitio se lea como una revista y no como nueve plantillas.
 */
export function CabeceraPagina({
  eyebrow,
  titulo,
  entradilla,
  paleta,
  forma,
}: {
  eyebrow: string;
  titulo: string;
  entradilla: string;
  paleta: PaletaCover;
  forma?: FormaCover;
}) {
  return (
    <header className="flex flex-col gap-8 pt-12 pb-4 sm:pt-16">
      <div className="flex flex-col gap-4">
        <Revelar>
          <p className="text-[0.8125rem] font-medium text-tenue">{eyebrow}</p>
        </Revelar>
        <Revelar indice={1}>
          {/* `tabIndex` para que el foco aterrice aqui tras navegar. No es
              enfocable con Tab: -1 solo lo hace enfocable por codigo. */}
          <h1
            tabIndex={-1}
            className="max-w-[18ch] text-[clamp(2.25rem,1.6rem+2.6vw,3rem)] leading-[1.16] font-medium tracking-[-0.03em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-texto"
          >
            {titulo}
          </h1>
        </Revelar>
        <Revelar indice={2}>
          <p className="max-w-[58ch] text-suave">{entradilla}</p>
        </Revelar>
      </div>

      <Revelar indice={3}>
        <Cover variante={paleta} forma={forma} ratio="16/9" />
      </Revelar>
    </header>
  );
}
