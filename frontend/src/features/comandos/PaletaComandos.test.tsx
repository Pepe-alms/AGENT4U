import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PaletaComandos } from '@/features/comandos/PaletaComandos';
import type { Comando } from '@/features/comandos/comandos';

function comandos(ejecutar = vi.fn()): Comando[] {
  return [
    { id: 'nueva', titulo: 'Nueva conversación', grupo: 'Acciones', ejecutar },
    { id: 'docs', titulo: 'Ir a documentos', grupo: 'Ir a', ejecutar },
    {
      id: 'hilo',
      titulo: '¿Qué dice el teorema CAP?',
      grupo: 'Conversaciones',
      ejecutar,
    },
  ];
}

describe('PaletaComandos', () => {
  it('lista los comandos agrupados cuando está abierta', () => {
    render(<PaletaComandos abierta alCerrar={vi.fn()} comandos={comandos()} />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByText('Acciones')).toBeTruthy();
  });

  it('filtra según se escribe, ignorando acentos', async () => {
    const usuario = userEvent.setup();
    render(<PaletaComandos abierta alCerrar={vi.fn()} comandos={comandos()} />);

    await usuario.type(screen.getByRole('combobox'), 'conversacion');
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('mueve la selección con las flechas y ejecuta con Enter', async () => {
    const usuario = userEvent.setup();
    const ejecutar = vi.fn();
    const alCerrar = vi.fn();
    render(<PaletaComandos abierta alCerrar={alCerrar} comandos={comandos(ejecutar)} />);

    const buscador = screen.getByRole('combobox');
    await usuario.click(buscador);
    await usuario.keyboard('{ArrowDown}{Enter}');

    expect(ejecutar).toHaveBeenCalled();
    // Ejecutar un comando cierra la paleta: si no, tapa lo que acaba de hacer.
    expect(alCerrar).toHaveBeenCalled();
  });

  it('da la vuelta al llegar al final de la lista', async () => {
    const usuario = userEvent.setup();
    render(<PaletaComandos abierta alCerrar={vi.fn()} comandos={comandos()} />);

    await usuario.click(screen.getByRole('combobox'));
    // Desde la primera hacia arriba se va a la última.
    await usuario.keyboard('{ArrowUp}');

    const opciones = screen.getAllByRole('option');
    expect(opciones[2]!.getAttribute('aria-selected')).toBe('true');
  });

  it('avisa cuando nada coincide', async () => {
    const usuario = userEvent.setup();
    render(<PaletaComandos abierta alCerrar={vi.fn()} comandos={comandos()} />);

    await usuario.type(screen.getByRole('combobox'), 'xyzzy');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/nada coincide/i)).toBeTruthy();
  });
});
