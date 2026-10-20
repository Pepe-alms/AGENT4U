import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * La URL base se lee al importar el módulo, porque Vite sustituye
 * `import.meta.env.VITE_API_URL` por su valor al construir. Por eso cada prueba
 * descarta los módulos y vuelve a importar: no hay forma de cambiarla después.
 */
async function clienteCon(urlBase: string | undefined) {
  if (urlBase === undefined) vi.stubEnv('VITE_API_URL', '');
  else vi.stubEnv('VITE_API_URL', urlBase);

  vi.resetModules();
  return import('@/shared/api/cliente');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('la URL base del backend', () => {
  it('sin VITE_API_URL falla por configuración, no por red', async () => {
    // El tipo importa más que el mensaje: 'red' manda al usuario a comprobar si
    // el backend está arrancado, y ese no es el problema. Un bundle construido
    // sin la variable no se arregla reintentando.
    const { peticion } = await clienteCon(undefined);
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);

    await expect(peticion('/documentos')).rejects.toMatchObject({
      name: 'ErrorApi',
      tipo: 'configuracion',
    });

    // Y la petición no sale. Esto es lo que prueba que la comprobación está
    // FUERA del try que traduce los fallos a 'red': si estuviera dentro, el
    // error saldría disfrazado y esta aserción no lo distinguiría.
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('con VITE_API_URL pega la ruta detrás, sin barras de más', async () => {
    const { peticion } = await clienteCon('/api');
    const fetchFalso = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchFalso);

    await peticion('/documentos');

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(fetchFalso.mock.calls[0][0]).toBe('/api/documentos');
  });

  it('acepta también una URL absoluta, que es lo que usa el desarrollo', async () => {
    const { peticion } = await clienteCon('http://localhost:8000');
    const fetchFalso = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchFalso);

    await peticion('/health');

    expect(fetchFalso.mock.calls[0][0]).toBe('http://localhost:8000/health');
  });
});
