import { expect, test, type Page } from '@playwright/test';

/**
 * Los tres desenlaces de la deduplicacion, contra el backend falso. Cada
 * prueba trabaja en su propia sesion del servidor, para que empiece sin
 * documentos y los ids sean previsibles.
 */
const RUTA_APP = '/app';

test.beforeEach(async ({ page }, info) => {
  await page.setExtraHTTPHeaders({
    'x-sesion-prueba': `dedup-${info.project.name}-${info.testId}`,
  });
});

async function abrirDocumentos(page: Page) {
  await page.goto(RUTA_APP);
  await page.getByRole('button', { name: 'Documentos indexados' }).click();
  await page.getByRole('tab', { name: 'Fichero' }).click();
}

async function subir(page: Page, nombre: string, contenido: string) {
  await page.setInputFiles('input[type=file]', {
    name: nombre,
    mimeType: 'application/pdf',
    buffer: Buffer.from(contenido),
  });
}

const cola = (page: Page) => page.getByRole('dialog').getByRole('listitem');

test('el mismo fichero con otro nombre se rechaza diciendo con cuál coincide', async ({
  page,
}) => {
  await abrirDocumentos(page);
  await subir(page, 'manual-cap.pdf', '%PDF-1.4 el mismo');
  await expect(page.getByTitle(/\/manual-cap\.pdf$/)).toBeVisible();

  await subir(page, 'copia-renombrada.pdf', '%PDF-1.4 el mismo');

  const aviso = cola(page).filter({ hasText: 'copia-renombrada.pdf' });
  await expect(aviso).toContainText(
    'Ya lo tienes: es exactamente el mismo fichero que manual-cap.pdf. No se ha indexado.',
  );
  // Desde el aviso se abre el original en el visor.
  await aviso.getByRole('button', { name: 'Abrir manual-cap.pdf' }).click();
  await expect(page).toHaveURL(/\/app\/documentos\/1$/);
});

test('el mismo contenido en otro fichero queda como duplicado, sin indexarse', async ({
  page,
}) => {
  await abrirDocumentos(page);
  await subir(page, 'manual-cap.pdf', '%PDF-1.4 original');
  await expect(page.getByTitle(/\/manual-cap\.pdf$/)).toBeVisible();

  await subir(page, 'manual-cap-mismo-contenido.docx', 'PK otro envoltorio');

  await expect(
    cola(page).filter({ hasText: 'manual-cap-mismo-contenido.docx' }).first(),
  ).toContainText('No indexado: tiene el mismo contenido que manual-cap.pdf.');
  // Y en la lista, con su etiqueta y el original.
  const fila = page.getByRole('listitem').filter({ hasText: 'duplicado' });
  await expect(fila).toContainText('mismo contenido que manual-cap.pdf');
  await expect(fila.getByRole('button', { name: 'Abrir original' })).toBeVisible();
});

test('una posible versión nueva espera la decisión y se puede conservar', async ({
  page,
}) => {
  await abrirDocumentos(page);
  await subir(page, 'manual-cap.pdf', '%PDF-1.4 version 1');
  await expect(page.getByTitle(/\/manual-cap\.pdf$/)).toBeVisible();

  await subir(page, 'manual-cap-v2.pdf', '%PDF-1.4 version 2');

  const pendiente = cola(page).filter({ hasText: 'manual-cap-v2.pdf' }).first();
  await expect(pendiente).toContainText(
    'Se parece a «manual-cap.pdf»: el 75 % de este ya está en aquel, y el 90 % de aquel está en este.',
  );
  for (const accion of ['Reemplazar', 'Conservar los dos', 'Descartar']) {
    await expect(pendiente.getByRole('button', { name: accion })).toBeVisible();
  }
  // En la lista sale igual, con la etiqueta legible.
  await expect(page.getByText('¿nueva versión?')).toBeVisible();

  await pendiente.getByRole('button', { name: 'Conservar los dos' }).click();

  // Se indexa y quedan los dos.
  await expect(pendiente.getByText('12 frag.')).toBeVisible();
  await expect(page.getByText('¿nueva versión?')).toHaveCount(0);
  await expect(page.getByTitle(/\/manual-cap\.pdf$/)).toBeVisible();
  await expect(page.getByTitle(/\/manual-cap-v2\.pdf$/)).toBeVisible();
});

test('reemplazar borra el antiguo, y descartar borra el nuevo', async ({ page }) => {
  await abrirDocumentos(page);
  await subir(page, 'manual-cap.pdf', '%PDF-1.4 version 1');
  await expect(page.getByTitle(/\/manual-cap\.pdf$/)).toBeVisible();
  await subir(page, 'manual-cap-v2.pdf', '%PDF-1.4 version 2');
  const pendiente = cola(page).filter({ hasText: 'manual-cap-v2.pdf' }).first();

  await pendiente.getByRole('button', { name: 'Reemplazar' }).click();

  await expect(pendiente.getByText('12 frag.')).toBeVisible();
  await expect(page.getByTitle(/\/manual-cap\.pdf$/)).toHaveCount(0);

  // Otra version: esta vez se descarta y el que habia sigue.
  await subir(page, 'manual-cap-v2-bis.pdf', '%PDF-1.4 version 3');
  const otra = cola(page).filter({ hasText: 'manual-cap-v2-bis.pdf' }).first();
  await otra.getByRole('button', { name: 'Descartar' }).click();

  await expect(otra).toContainText('Descartado');
  await expect(page.getByTitle(/\/manual-cap-v2-bis\.pdf$/)).toHaveCount(0);
  await expect(page.getByTitle(/\/manual-cap-v2\.pdf$/)).toBeVisible();
});

test('desde un pendiente se abre el documento con el que se compara', async ({
  page,
}) => {
  await abrirDocumentos(page);
  await subir(page, 'manual-cap.pdf', '%PDF-1.4 version 1');
  await expect(page.getByTitle(/\/manual-cap\.pdf$/)).toBeVisible();
  await subir(page, 'manual-cap-v2.pdf', '%PDF-1.4 version 2');

  await cola(page)
    .filter({ hasText: 'manual-cap-v2.pdf' })
    .first()
    .getByRole('button', { name: 'Ver manual-cap.pdf' })
    .click();

  await expect(page).toHaveURL(/\/app\/documentos\/1$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'manual-cap.pdf' }),
  ).toBeVisible();
});
