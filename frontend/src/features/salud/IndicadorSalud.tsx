import type { EstadoQdrant, Salud } from '@/shared/api/salud';
import { Tooltip } from '@/shared/ui/Tooltip';

const QDRANT: Record<EstadoQdrant, { detalle: string }> = {
  ok: { detalle: 'Qdrant responde y la colección existe.' },
  'sin-coleccion': {
    detalle: 'Qdrant responde, pero la colección aún no existe: no hay nada indexado.',
  },
  error: { detalle: 'El backend responde, pero no consigue hablar con Qdrant.' },
  desconocido: { detalle: 'No se ha podido preguntar por Qdrant.' },
};

/**
 * El estado del sistema, y **callado cuando no hay nada que contar**.
 *
 * Con el backend y Qdrant en orden queda un unico punto gris muy tenue: el
 * estado normal no merece sitio en la barra. En cuanto algo se tuerce aparecen
 * el color y la palabra.
 *
 * Antes eran dos insignias con texto ("En linea", "Sin indexar") que ocupaban
 * un tercio de la barra para decir algo que el 99% del tiempo es "no pasa
 * nada", y despues dos puntos indistinguibles entre si. Esto es lo mismo con
 * una regla clara: ruido solo cuando hay motivo.
 *
 * El texto no desaparece nunca para quien use lector de pantalla: va en el
 * tooltip, asociado con `aria-describedby`, y en un `.solo-lectores`.
 *
 * Se sondean dos cosas y no una porque "backend caido" y "backend vivo con
 * Qdrant caido" son averias distintas y se arreglan de forma distinta.
 */
export function IndicadorSalud({
  salud,
  comprobando,
}: {
  salud: Salud;
  comprobando: boolean;
}) {
  if (comprobando) {
    return (
      <Punto nombre="Estado" texto="Conectando" late detalle="Comprobando la conexión…" />
    );
  }

  if (salud.backend === 'caido') {
    return (
      <Aviso
        tono="error"
        texto="Sin conexión"
        detalle="El backend no responde. Arráncalo y se reintentará solo."
      />
    );
  }

  const detalleQdrant = salud.detalle
    ? `${QDRANT[salud.qdrant].detalle} ${salud.detalle}`
    : QDRANT[salud.qdrant].detalle;

  // Qdrant con algo que decir manda sobre el "todo bien" del backend: es lo
  // unico de los dos sobre lo que el usuario tendria que hacer algo.
  if (salud.qdrant === 'error') {
    return <Aviso tono="error" texto="Qdrant" detalle={detalleQdrant} />;
  }
  if (salud.qdrant === 'sin-coleccion') {
    return <Aviso tono="aviso" texto="Sin indexar" detalle={detalleQdrant} />;
  }

  const latencia =
    salud.latenciaMs === undefined ? '' : ` Responde en ${salud.latenciaMs} ms.`;

  return (
    <Punto
      nombre="Estado"
      texto="Todo en orden"
      late={false}
      detalle={`El backend responde.${latencia} ${detalleQdrant}`}
    />
  );
}

/** El estado tranquilo: un punto y nada mas. */
function Punto({
  nombre,
  texto,
  late,
  detalle,
}: {
  nombre: string;
  texto: string;
  late: boolean;
  detalle: string;
}) {
  return (
    <span role="status">
      <Tooltip texto={detalle}>
        {/* El area sensible es de 32px aunque el punto mida 6: un objetivo de
            6px no se acierta con el raton y menos con el dedo. */}
        <span className="grid size-8 place-items-center">
          <span
            className={`size-[6px] rounded-full bg-tenue ${late ? 'motion-safe:animate-pulse' : ''}`}
            aria-hidden="true"
          />
          <span className="solo-lectores">
            {nombre}: {texto}
          </span>
        </span>
      </Tooltip>
    </span>
  );
}

/** Lo que se enseña cuando si hay algo que contar: color y palabra. */
function Aviso({
  tono,
  texto,
  detalle,
}: {
  tono: 'error' | 'aviso';
  texto: string;
  detalle: string;
}) {
  return (
    <span role="status">
      <Tooltip texto={detalle}>
        <span
          className={[
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium',
            tono === 'error' ? 'bg-error-fondo text-error' : 'bg-aviso-fondo text-aviso',
          ].join(' ')}
        >
          <span
            className={`size-[6px] shrink-0 rounded-full ${tono === 'error' ? 'bg-error' : 'bg-aviso'}`}
            aria-hidden="true"
          />
          {texto}
        </span>
      </Tooltip>
    </span>
  );
}
