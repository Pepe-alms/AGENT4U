import { afterEach, describe, expect, it, vi } from 'vitest';

async function clienteCon(urlBase: string) {
  vi.stubEnv('VITE_API_URL', urlBase);
  vi.resetModules();
  return import('@/shared/api/graphql');
}

function respuestaJson(cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('graphql', () => {
  it('manda la query al endpoint /graphql por POST', async () => {
    const { graphql } = await clienteCon('http://localhost:8080');
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(respuestaJson({ data: { ajustes: { modelos: ['x'] } } }));
    vi.stubGlobal('fetch', fetchFalso);

    const datos = await graphql<{ ajustes: { modelos: string[] } }>(
      '{ ajustes { modelos } }',
    );

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/graphql');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      query: '{ ajustes { modelos } }',
    });
    expect(datos).toEqual({ ajustes: { modelos: ['x'] } });
  });

  it('manda las variables cuando se pasan', async () => {
    const { graphql } = await clienteCon('http://localhost:8080');
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(respuestaJson({ data: { trabajo: null } }));
    vi.stubGlobal('fetch', fetchFalso);

    await graphql('query($jobId: String!) { trabajo(job_id: $jobId) { status } }', {
      jobId: 'abc-123',
    });

    const [, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'query($jobId: String!) { trabajo(job_id: $jobId) { status } }',
      variables: { jobId: 'abc-123' },
    });
  });

  it('devuelve directamente el campo "data" de la respuesta', async () => {
    const { graphql } = await clienteCon('http://localhost:8080');
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(respuestaJson({ data: { documentos: [] } }));
    vi.stubGlobal('fetch', fetchFalso);

    const datos = await graphql<{ documentos: unknown[] }>('{ documentos { id } }');

    expect(datos).toEqual({ documentos: [] });
  });

  it('un error GraphQL con extensions.status se convierte en ErrorApi con ese estado', async () => {
    const { graphql } = await clienteCon('http://localhost:8080');
    const fetchFalso = vi.fn().mockResolvedValue(
      respuestaJson({
        data: null,
        errors: [{ message: 'Ya existe', extensions: { status: 409 } }],
      }),
    );
    vi.stubGlobal('fetch', fetchFalso);

    await expect(
      graphql('mutation { indexar(file_path: "x", type: "pdf") { job_id } }'),
    ).rejects.toMatchObject({ name: 'ErrorApi', message: 'Ya existe', estado: 409 });
  });

  it('un error GraphQL sin extensions.status no trae un codigo HTTP', async () => {
    const { graphql } = await clienteCon('http://localhost:8080');
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(
        respuestaJson({ data: null, errors: [{ message: 'Fallo interno' }] }),
      );
    vi.stubGlobal('fetch', fetchFalso);

    await expect(graphql('{ ajustes { modelos } }')).rejects.toMatchObject({
      name: 'ErrorApi',
      estado: undefined,
    });
  });

  it('data nulo sin errores se trata como respuesta invalida', async () => {
    const { graphql } = await clienteCon('http://localhost:8080');
    const fetchFalso = vi.fn().mockResolvedValue(respuestaJson({ data: null }));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(graphql('{ ajustes { modelos } }')).rejects.toMatchObject({
      name: 'ErrorApi',
      tipo: 'respuesta',
    });
  });
});
