import { expect, test, type Page } from '@playwright/test';

/**
 * El visor de documentos, contra el backend falso. El documento 1 tiene 500
 * paginas (~1,3 MB de Markdown): es tambien la prueba de que sigue fluido.
 */
const RUTA_APP = '/app';

async function preguntar(page: Page) {
  await page.goto(RUTA_APP);
  const campo = page.getByLabel(/escribe tu pregunta/i);
  await campo.fill('¿Qué dice el teorema CAP?');
  await campo.press('Enter');
  await expect(
    page
      .getByLabel('Respuesta del agente')
      .getByRole('heading', { name: 'El teorema CAP' }),
  ).toBeVisible();
}

test('desde una fuente se abre el documento en su sección, y al volver el chat sigue igual', async ({
  page,
}) => {
  await preguntar(page);

  // La cita abre las fuentes: en escritorio es la columna, en móvil un panel.
  await page.getByRole('button', { name: /Ver la fuente 1/ }).click();
  const fuente = page.locator('[data-fuente="1"]').last();
  await expect(fuente.getByRole('button', { name: 'Ver en el documento' })).toBeVisible();
  // La fuente secundaria no trae documento_id: no ofrece un salto que no lleva a nada.
  await expect(
    page
      .locator('[data-fuente="2"]')
      .last()
      .getByRole('button', { name: 'Ver en el documento' }),
  ).toHaveCount(0);

  const inicio = Date.now();
  await fuente.getByRole('button', { name: 'Ver en el documento' }).click();

  await expect(page).toHaveURL(/\/app\/documentos\/1\?pagina=163&seccion=Teorema\+CAP$/);
  const destino = page.locator('section[aria-current="location"]');
  await expect(destino.getByRole('heading', { name: 'Teorema CAP' })).toBeInViewport();
  const milisegundos = Date.now() - inicio;
  await expect(destino).toContainText('De aquí sale la fuente · pág. 163');
  test
    .info()
    .annotations.push({ type: 'salto a la fuente', description: `${milisegundos} ms` });
  expect(milisegundos).toBeLessThan(3000);

  // De 500 páginas solo se han convertido unas pocas secciones.
  const total = await page.locator('section[data-seccion]').count();
  const pintadas = await page.locator('section[data-pintada]').count();
  test
    .info()
    .annotations.push({ type: 'secciones', description: `${pintadas} de ${total}` });
  expect(total).toBeGreaterThan(200);
  expect(pintadas).toBeLessThan(20);

  // El Markdown es de terceros: el intento de XSS del documento no se ejecuta.
  expect(
    await page.evaluate(() => (window as { __xss?: boolean }).__xss),
  ).toBeUndefined();
  await expect(destino.locator('script, img')).toHaveCount(0);

  // El chat de debajo no se ha desmontado: al volver, la respuesta sigue ahí.
  await page.getByRole('link', { name: 'Volver al chat' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page
      .getByLabel('Respuesta del agente')
      .getByRole('heading', { name: 'El teorema CAP' }),
  ).toBeVisible();
  await expect(page.getByRole('article', { name: 'Tu pregunta' })).toHaveCount(1);
});

test('desde la lista de documentos se abre el documento por el principio', async ({
  page,
}) => {
  await page.goto(RUTA_APP);
  await page.getByRole('button', { name: 'Documentos indexados' }).click();
  await page.getByRole('tab', { name: 'Fichero' }).click();
  await page.setInputFiles('input[type=file]', {
    name: 'manual-cap.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 contenido de prueba'),
  });

  await page.getByRole('button', { name: 'Leer manual-cap.pdf' }).click();

  await expect(page).toHaveURL(/\/app\/documentos\/1$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'manual-cap.pdf' }),
  ).toBeVisible();
  await expect(page.getByText('500 pág.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Manual de sistemas distribuidos' }),
  ).toBeInViewport();
  // El panel de documentos se ha cerrado: un <dialog> modal taparía el visor.
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('bajando hasta el final se va pintando el documento entero sin atascarse', async ({
  page,
}) => {
  await page.goto(`${RUTA_APP}/documentos/1`);
  await expect(page.getByText('500 pág.')).toBeVisible();

  // Como quien pulsa Fin: bajar del todo hasta que se ve la ultima pagina.
  // Las secciones que se pintan al llegar pueden medir algo distinto de lo
  // estimado, asi que puede hacer falta mas de un intento, pero pocos.
  const zona = page.locator('[data-zona-lectura]');
  const ultimaPagina = page.getByRole('cell', { name: '500', exact: true });
  let intentos = 0;
  await expect(async () => {
    intentos++;
    await zona.evaluate((nodo) => nodo.scrollTo(0, nodo.scrollHeight));
    await expect(ultimaPagina).toBeInViewport({ timeout: 250 });
  }).toPass({ timeout: 5000 });
  test
    .info()
    .annotations.push({ type: 'intentos hasta el final', description: String(intentos) });
  expect(intentos).toBeLessThanOrEqual(3);
});

test('un documento sin contenido guardado lo explica, en vez de un error genérico', async ({
  page,
}) => {
  await page.goto(`${RUTA_APP}/documentos/2`);

  await expect(
    page.getByText('Este documento no tiene su contenido guardado'),
  ).toBeVisible();
  await expect(page.getByText(/generar_contenido\.py/)).toBeVisible();
});

test('un documento que no existe lo dice', async ({ page }) => {
  await page.goto(`${RUTA_APP}/documentos/99`);

  await expect(page.getByText('Ese documento ya no existe')).toBeVisible();
  await page.getByRole('link', { name: 'Volver al chat' }).click();
  await expect(page).toHaveURL(/\/app$/);
});
