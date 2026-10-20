import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FormularioIngesta } from '@/features/documentos/FormularioIngesta';
import type { Trabajo } from '@/features/documentos/ingesta';
import type { Ingesta } from '@/features/documentos/useIngesta';

const MAX = 5;

function enMarcha(cuantos: number): Trabajo[] {
  return Array.from({ length: cuantos }, (_, i) => ({
    id: `t${i}`,
    origen: `/docs/${i}.pdf`,
    clase: 'subida' as const,
    fase: 'indexando' as const,
  }));
}

/**
 * `Ingesta` entra por props, así que el formulario se puede probar sin red y
 * sin el hook: se le da el cupo que interese y se mira qué hace con él.
 */
function montar(huecos: number) {
  const subir = vi.fn<(f: File[]) => File[]>(() => []);
  const indexar = vi.fn();
  const ingesta: Ingesta = {
    trabajos: enMarcha(MAX - huecos),
    indexar,
    subir,
    olvidar: vi.fn(),
    huecos,
    maxEnVuelo: MAX,
  };

  render(<FormularioIngesta ingesta={ingesta} />);
  return { subir, indexar };
}

/** El selector está oculto a propósito; se llega a él por su tipo. */
function selectorDeFicheros(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no hay selector de ficheros');
  return input;
}

async function irAFicheros(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByRole('tab', { name: 'Fichero' }));
}

function pdfs(cuantos: number): File[] {
  return Array.from(
    { length: cuantos },
    (_, i) => new File(['contenido'], `doc${i}.pdf`, { type: 'application/pdf' }),
  );
}

describe('FormularioIngesta · el cupo de ficheros', () => {
  it('con los cinco huecos libres, deja adjuntar cinco', async () => {
    const usuario = userEvent.setup();
    const { subir } = montar(MAX);
    await irAFicheros(usuario);

    await usuario.upload(selectorDeFicheros(), pdfs(5));

    expect(subir).toHaveBeenCalledTimes(1);
    expect(subir.mock.calls[0]![0]).toHaveLength(5);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('si se eligen seis, solo manda cinco y dice cuál se queda fuera', async () => {
    const usuario = userEvent.setup();
    const { subir } = montar(MAX);
    await irAFicheros(usuario);

    await usuario.upload(selectorDeFicheros(), pdfs(6));

    // Cinco, no seis: el sexto no sale a la red.
    const enviados = subir.mock.calls[0]![0];
    expect(enviados).toHaveLength(5);
    expect(enviados.map((f) => f.name)).not.toContain('doc5.pdf');

    // Y se dice qué pasó, nombrando el fichero: «no caben» sin más dejaría al
    // usuario adivinando cuál de los seis falta.
    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent('Solo caben 5 más');
    expect(aviso).toHaveTextContent('doc5.pdf');
  });

  it('con dos en marcha solo caben tres, y lo avisa antes de elegir', async () => {
    const usuario = userEvent.setup();
    const { subir } = montar(3);
    await irAFicheros(usuario);

    expect(screen.getByText(/caben 3 ficheros más/i)).toBeInTheDocument();

    await usuario.upload(selectorDeFicheros(), pdfs(4));

    expect(subir.mock.calls[0]![0]).toHaveLength(3);
    expect(screen.getByRole('alert')).toHaveTextContent('Solo caben 3 más');
  });

  it('sin huecos no se puede adjuntar nada: la zona y el selector se desactivan', async () => {
    const usuario = userEvent.setup();
    const { subir } = montar(0);
    await irAFicheros(usuario);

    expect(selectorDeFicheros()).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /no caben más por ahora/i }),
    ).toBeDisabled();
    expect(screen.getByText(/5 de 5 en marcha: no caben más/i)).toBeInTheDocument();

    // Pulsar la zona no abre el selector, así que no hay forma de añadir nada.
    await usuario.click(screen.getByRole('button', { name: /no caben más por ahora/i }));
    expect(subir).not.toHaveBeenCalled();
  });

  it('sin huecos tampoco se puede indexar una ruta del servidor', async () => {
    const usuario = userEvent.setup();
    const { indexar } = montar(0);
    await irAFicheros(usuario);

    // Una ruta es la misma indexación por detrás: ocupa hueco igual que una
    // subida, así que el botón tiene que estar desactivado también.
    await usuario.type(screen.getByLabelText(/una ruta que ya esté/i), '/docs/x.pdf');

    expect(screen.getByRole('button', { name: 'Indexar' })).toBeDisabled();
    expect(indexar).not.toHaveBeenCalled();
  });

  it('un fichero no admitido se rechaza antes que el cupo, al soltarlo', async () => {
    const usuario = userEvent.setup();
    const { subir } = montar(MAX);
    await irAFicheros(usuario);

    // Por el selector no hace falta comprobarlo: el atributo `accept` ya filtra,
    // y `userEvent.upload` lo respeta igual que el navegador. El filtro del
    // código existe para ESTE camino, el de arrastrar y soltar, donde `accept`
    // no pinta nada y el usuario puede soltar lo que quiera.
    fireEvent.drop(screen.getByRole('button', { name: /suelta tus ficheros/i }), {
      dataTransfer: { files: [new File(['x'], 'foto.png', { type: 'image/png' })] },
    });

    expect(subir).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('No se puede indexar');
  });

  it('al soltar seis también se corta en cinco', async () => {
    const usuario = userEvent.setup();
    const { subir } = montar(MAX);
    await irAFicheros(usuario);

    fireEvent.drop(screen.getByRole('button', { name: /suelta tus ficheros/i }), {
      dataTransfer: { files: pdfs(6) },
    });

    expect(subir.mock.calls[0]![0]).toHaveLength(5);
    expect(screen.getByRole('alert')).toHaveTextContent('doc5.pdf');
  });
});
