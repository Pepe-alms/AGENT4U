import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Composer } from '@/features/chat/Composer';

function montar() {
  const onEnviar = vi.fn();
  const onDetener = vi.fn();
  render(<Composer enviando={false} onEnviar={onEnviar} onDetener={onDetener} />);
  return { onEnviar, onDetener, campo: screen.getByLabelText(/escribe tu pregunta/i) };
}

describe('Composer', () => {
  it('envía con Enter y vacía el campo', async () => {
    const usuario = userEvent.setup();
    const { onEnviar, campo } = montar();

    await usuario.type(campo, '¿Qué dice el teorema CAP?');
    await usuario.keyboard('{Enter}');

    expect(onEnviar).toHaveBeenCalledWith('¿Qué dice el teorema CAP?');
    expect(campo).toHaveValue('');
  });

  // Shift+Enter tiene que poder escribir párrafos sin enviar a medias.
  it('con Shift+Enter salta de línea y no envía', async () => {
    const usuario = userEvent.setup();
    const { onEnviar, campo } = montar();

    await usuario.type(campo, 'primera');
    await usuario.keyboard('{Shift>}{Enter}{/Shift}');
    await usuario.type(campo, 'segunda');

    expect(onEnviar).not.toHaveBeenCalled();
    expect(campo).toHaveValue('primera\nsegunda');
  });

  it('no envía nada si solo hay espacios', async () => {
    const usuario = userEvent.setup();
    const { onEnviar, campo } = montar();

    await usuario.type(campo, '   ');
    await usuario.keyboard('{Enter}');

    expect(onEnviar).not.toHaveBeenCalled();
  });

  it('deshabilita el botón mientras no haya texto', async () => {
    const usuario = userEvent.setup();
    const { campo } = montar();

    expect(screen.getByRole('button', { name: /enviar la pregunta/i })).toBeDisabled();
    await usuario.type(campo, 'algo');
    expect(screen.getByRole('button', { name: /enviar la pregunta/i })).toBeEnabled();
  });

  it('mientras envía, el botón de enviar pasa a ser el de detener', async () => {
    const usuario = userEvent.setup();
    const onDetener = vi.fn();
    render(<Composer enviando onEnviar={vi.fn()} onDetener={onDetener} />);

    expect(screen.queryByRole('button', { name: /enviar la pregunta/i })).toBeNull();
    await usuario.click(screen.getByRole('button', { name: /detener la respuesta/i }));
    expect(onDetener).toHaveBeenCalled();
  });
});
