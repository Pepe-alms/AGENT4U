import { expect, test } from '@playwright/test';

/**
 * La aplicacion vive en /app desde que la portada paso a ser un sitio
 * editorial de varias paginas. `/` es ahora la portada del sitio.
 */
const RUTA_APP = '/app';

/**
 * El camino que da sentido al producto: meter un documento, preguntar por él y
 * poder comprobar de dónde sale la respuesta. Si esto pasa, la aplicación sirve.
 */
test('indexar un documento, preguntar y verificar la cita', async ({ page }) => {
  await page.goto(RUTA_APP);

  // --- Sin documentos, la bienvenida lo dice y ofrece a dónde ir ---
  await expect(
    page.getByRole('heading', { name: /no hay nada.*indexado/i }),
  ).toBeVisible();

  // --- Indexar: los documentos viven en su propio panel, no en la columna ---
  await page.getByRole('button', { name: 'Documentos indexados' }).click();
  await page.getByRole('tab', { name: 'Fichero' }).click();
  await page.setInputFiles('input[type=file]', {
    name: 'manual-cap.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 contenido de prueba'),
  });

  // Aparece en la cola con sus fragmentos y luego en la lista de documentos.
  await expect(page.getByText('12 frag.').first()).toBeVisible();
  await expect(page.getByTitle('/subidas/manual-cap.pdf')).toBeVisible();

  // El panel es modal: hay que cerrarlo para volver al chat.
  await page.getByRole('button', { name: 'Cerrar' }).click();

  // --- Preguntar ---
  const campo = page.getByLabel(/escribe tu pregunta/i);
  await campo.fill('¿Qué dice el teorema CAP?');
  await campo.press('Enter');

  const respuesta = page.getByLabel('Respuesta del agente');
  await expect(respuesta).toBeVisible();
  // El renderizador de markdown se carga aparte (lazy), así que hasta que
  // llega la respuesta se ve como texto plano. Esperar al encabezado es la
  // señal de que ya está montado; sin esto se interactúa con un DOM que React
  // va a reemplazar.
  await expect(respuesta.getByRole('heading', { name: 'El teorema CAP' })).toBeVisible();
  await expect(respuesta.locator('li')).toHaveCount(3);

  // --- Verificar la cita ---
  const cita = respuesta.locator('[data-cita="1"]');
  await expect(cita).toBeVisible();
  await cita.click();

  // La tarjeta de la fuente queda marcada, con su documento, sección y páginas.
  const fuente = page.locator('[data-fuente="1"]');
  await expect(fuente).toContainText('manual-cap.pdf');
  await expect(fuente).toContainText('Replicación › Teorema CAP');
  await expect(fuente).toContainText('pág. 163, 164');
  // El estado activo se comprueba por `aria-current`, no por una clase: la
  // clase es estilo y cambia con el diseño; esto es lo que significa.
  await expect(fuente.getByRole('article')).toHaveAttribute('aria-current', 'true');
});

test('el hilo sigue abierto después de recargar', async ({ page }) => {
  await page.goto(RUTA_APP);

  const campo = page.getByLabel(/escribe tu pregunta/i);
  await campo.fill('¿Qué dice el teorema CAP?');
  await campo.press('Enter');

  // Hay que esperar a la respuesta **renderizada**, no al `<article>`: el
  // reducer crea el mensaje del agente vacío al enviar, así que el artículo
  // existe desde el primer momento y esperarlo no espera a nada. El encabezado
  // solo aparece cuando el stream ha traído el markdown.
  await expect(
    page
      .getByLabel('Respuesta del agente')
      .getByRole('heading', { name: 'El teorema CAP' }),
  ).toBeVisible();

  await page.reload();

  // El id del hilo se guarda en local y los mensajes vuelven del backend.
  await expect(page.getByLabel('Respuesta del agente')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Tu pregunta' })).toContainText(
    'teorema CAP',
  );
});

test('se maneja con el teclado: Cmd+K abre la paleta y abre una conversación', async ({
  page,
}) => {
  // La paleta es un atajo de teclado fisico: en un movil no hay recorrido que
  // validar, porque no hay forma de invocarla.
  test.skip(
    (page.viewportSize()?.width ?? 1440) < 768,
    'la paleta se abre con un atajo de teclado',
  );
  await page.goto(RUTA_APP);

  const campo = page.getByLabel(/escribe tu pregunta/i);
  await campo.fill('¿Qué dice el teorema CAP?');
  await campo.press('Enter');
  await expect(
    page
      .getByLabel('Respuesta del agente')
      .getByRole('heading', { name: 'El teorema CAP' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Nueva conversación' }).click();
  // Sin conversación vuelve la bienvenida. Cuál de sus tres caras aparece
  // depende de si hay documentos, así que se mira el campo, que sale siempre.
  await expect(page.getByLabel(/escribe tu pregunta/i)).toBeVisible();
  await expect(page.getByLabel('Respuesta del agente')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+k');
  const buscador = page.getByRole('combobox');
  await expect(buscador).toBeFocused();

  await buscador.fill('teorema');
  await buscador.press('Enter');

  // La paleta se cierra sola y el hilo vuelve a estar en pantalla.
  await expect(buscador).toHaveCount(0);
  await expect(page.getByLabel('Respuesta del agente')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Tu pregunta' })).toContainText(
    'teorema CAP',
  );
});

test('se ven los pasos del agente y se pueden desplegar', async ({ page }) => {
  await page.goto(RUTA_APP);

  const campo = page.getByLabel(/escribe tu pregunta/i);
  await campo.fill('¿Qué dice el teorema CAP?');
  await campo.press('Enter');

  // Al terminar se pliega a una línea resumen con el total.
  const resumen = page.getByRole('button', { name: /pasos/ });
  await expect(resumen).toBeVisible();
  await expect(resumen).toHaveAttribute('aria-expanded', 'false');

  await resumen.click();
  await expect(resumen).toHaveAttribute('aria-expanded', 'true');

  // Los nodos reales del grafo, con sus cifras.
  await expect(page.getByText('Buscando en Qdrant')).toBeVisible();
  await expect(page.getByText('10 fragmentos')).toBeVisible();
  await expect(page.getByText('Descomponiendo en subconsultas')).toBeVisible();
});

test('el panel de fuentes enseña score, fragmento y subconsulta', async ({ page }) => {
  await page.goto(RUTA_APP);

  const campo = page.getByLabel(/escribe tu pregunta/i);
  await campo.fill('¿Qué dice el teorema CAP?');
  await campo.press('Enter');
  await expect(
    page
      .getByLabel('Respuesta del agente')
      .getByRole('heading', { name: 'El teorema CAP' }),
  ).toBeVisible();

  const primera = page.locator('[data-fuente="1"]');
  await expect(primera).toContainText('manual-cap.pdf');
  // El score del reordenador, crudo: no es un porcentaje.
  await expect(primera).toContainText('2.41');
  await expect(primera).toContainText('El teorema CAP establece');
  // Con multiconsulta, la consulta que encontró el fragmento no es la del usuario.
  await expect(primera).toContainText('garantías del teorema CAP');
});
