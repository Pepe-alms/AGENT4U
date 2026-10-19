import { expect, test, type Page } from '@playwright/test';

import { RUTAS_NAV } from '../src/routes';

/**
 * Los recorridos que haria una persona.
 *
 * A diferencia de `rutas.spec.ts`, que comprueba propiedades de cada ruta por
 * separado, aqui se encadenan pasos: lo que se valida es que el camino entero
 * funcione, no cada baldosa.
 */

const esMovil = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

/** El CTA vive en la barra en escritorio y dentro del menu en movil. */
async function abrirElAgente(page: Page) {
  if (esMovil(page)) {
    await page.getByRole('button', { name: /abrir el menú/i }).click();
    await page
      .getByRole('dialog', { name: 'Navegación' })
      .getByRole('link', { name: 'Abrir el agente' })
      .click();
    return;
  }
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Abrir el agente' })
    .click();
}

/** Abre el menu si hace falta y pulsa un enlace de la navegacion. */
async function navegarA(page: Page, nombre: string) {
  if (esMovil(page)) {
    await page.getByRole('button', { name: /abrir el menú/i }).click();
    await page
      .getByRole('dialog', { name: 'Navegación' })
      .getByRole('link', { name: nombre, exact: true })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: nombre, exact: true })
      .click();
  }
  await page.locator('h1').waitFor();
}

/* --- A. Visitante nuevo --- */

test('A · entra en la raíz, lee el hero y recorre el sitio hasta el final', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/home$/);

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Pregunta a tus documentos',
  );
  await expect(page.getByLabel(/escribe una pregunta/i)).toBeVisible();

  /*
   * Avanzar con "Siguiente" hasta que ya no haya. El tope evita que un
   * encadenado circular deje la prueba dando vueltas para siempre.
   *
   * Entre clic y clic hay que esperar a que llegue la pagina NUEVA, y esperar
   * a un `h1` generico no sirve: React Router envuelve las navegaciones en una
   * transicion, asi que mientras llega el paquete diferido la pagina anterior
   * sigue montada —con su propio h1 y su propio enlace "Siguiente"—. La prueba
   * encontraba ese enlace viejo y lo pulsaba justo cuando lo quitaban del DOM.
   *
   * Lo que si prueba que ha cambiado la pagina: la URL del destino, que se lee
   * del propio enlace, y un titular distinto al anterior.
   */
  const visitadas: string[] = [];
  for (let paso = 0; paso < 10; paso += 1) {
    visitadas.push(new URL(page.url()).pathname);

    const siguiente = page
      .getByRole('navigation', { name: 'Recorrido del sitio' })
      .getByRole('link', { name: /siguiente/i });
    if ((await siguiente.count()) === 0) break;

    const destino = await siguiente.getAttribute('href');
    const titularAnterior = (await page.locator('h1').textContent()) ?? '';

    await siguiente.click();

    await expect(page).toHaveURL(new RegExp(`${destino}$`));
    await expect(page.locator('h1')).not.toHaveText(titularAnterior);
  }

  // El recorrido llega al final y no se repite ninguna: eso seria un bucle.
  expect(new Set(visitadas).size).toBe(visitadas.length);
  expect(visitadas.length).toBeGreaterThanOrEqual(3);
  expect(visitadas[0]).toBe('/home');
  // En la ultima no hay "Siguiente", que es como se sabe que es la ultima.
  await expect(
    page
      .getByRole('navigation', { name: 'Recorrido del sitio' })
      .getByRole('link', { name: /siguiente/i }),
  ).toHaveCount(0);
});

/* --- B. Perfil técnico: deep link de un componente --- */

test('B · abre un nodo del diagrama, recarga y vuelve atrás', async ({ page }) => {
  await page.goto('/home');
  await navegarA(page, 'Arquitectura');

  await expect(page.getByText(/ninguna pieza seleccionada/i)).toBeVisible();

  await page.getByRole('button', { name: /Qdrant: Vector store/ }).click();
  await expect(page).toHaveURL(/\/arquitectura\/qdrant$/);

  const panel = page.getByRole('complementary', { name: /detalle de qdrant/i });
  await expect(panel).toContainText('FastEmbed');

  // Recargar: el estado vive en la URL, así que tiene que volver igual.
  await page.reload();
  await expect(
    page.getByRole('complementary', { name: /detalle de qdrant/i }),
  ).toContainText('FastEmbed');
  // Y las migas reflejan que se está en la ruta hija.
  await expect(page.getByRole('navigation', { name: 'Migas de pan' })).toContainText(
    'Componente',
  );

  await page.goBack();
  await expect(page).toHaveURL(/\/arquitectura$/);
  await expect(page.getByText(/ninguna pieza seleccionada/i)).toBeVisible();
});

test('B2 · cerrar el panel no deja pasos muertos en el historial', async ({ page }) => {
  await page.goto('/home');
  await navegarA(page, 'Arquitectura');

  await page.getByRole('button', { name: /Qdrant: Vector store/ }).click();
  await expect(page).toHaveURL(/\/arquitectura\/qdrant$/);

  await page
    .getByRole('complementary', { name: /detalle de qdrant/i })
    .getByRole('button', { name: /cerrar el detalle/i })
    .click();
  await expect(page).toHaveURL(/\/arquitectura$/);

  /*
   * La prueba de verdad: el siguiente "atrás" tiene que SALIR de
   * /arquitectura, no quedarse en ella. Con la versión anterior —abrir apila,
   * cerrar apila— el historial quedaba [/arquitectura, /arquitectura] y este
   * paso no hacía nada visible.
   */
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
});

test('B3 · por deep link, cerrar y volver atrás no reabre el panel', async ({ page }) => {
  // Se entra desde otra página para tener un paso anterior conocido.
  await page.goto('/tecnologias');
  await page.goto('/arquitectura/qdrant');

  await expect(
    page.getByRole('complementary', { name: /detalle de qdrant/i }),
  ).toBeVisible();

  await page
    .getByRole('complementary', { name: /detalle de qdrant/i })
    .getByRole('button', { name: /cerrar el detalle/i })
    .click();
  await expect(page).toHaveURL(/\/arquitectura$/);

  // Cerrar reemplazó, así que atrás sale del sitio hacia la página previa y
  // NUNCA reabre el panel.
  await page.goBack();
  await expect(page).toHaveURL(/\/tecnologias$/);
  await expect(
    page.getByRole('complementary', { name: /detalle de qdrant/i }),
  ).toHaveCount(0);
});

/* --- C. Exploración con filtros --- */

test('C · filtra tecnologías y el filtro viaja en la URL', async ({ page, context }) => {
  await page.goto('/tecnologias');
  await page.locator('h1').waitFor();

  const contador = page.getByText(/herramientas/);
  const todas = Number((await contador.textContent())?.match(/\d+/)?.[0] ?? 0);

  await page.getByRole('button', { name: 'Backend', exact: true }).click();
  await expect(page).toHaveURL(/\?capa=backend$/);
  await expect(contador).toContainText('en Backend');

  // La prueba de verdad: la URL copiada reproduce la misma vista.
  const url = page.url();
  const otra = await context.newPage();
  await otra.goto(url);
  await otra.locator('h1').waitFor();

  await expect(otra.getByText(/en Backend/)).toBeVisible();
  await expect(
    otra.getByRole('button', { name: 'Backend', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const filtradas = Number(
    (await otra.getByText(/herramientas/).textContent())?.match(/\d+/)?.[0] ?? 0,
  );
  expect(filtradas).toBeGreaterThan(0);
  expect(filtradas).toBeLessThan(todas);
  await otra.close();
});

/* --- D. Deep link con ancla --- */

test('D · un enlace con #ancla lleva al ancla, no al principio de la página', async ({
  page,
}) => {
  await page.goto('/home#coleccion');
  await page.locator('h1').waitFor();

  // `toBeInViewport` es la aserción web-first para esto: reintenta sola y no
  // hay que medir cajas a mano. Un hash que cambia la URL y deja la página
  // arriba es exactamente el fallo que vigila.
  await expect(page.locator('#coleccion')).toBeInViewport();
});

test('D2 · el ancla funciona con la CPU 4× más lenta', async ({ page, browserName }) => {
  /*
   * Esta prueba existe porque la versión anterior resolvía el ancla
   * reintentando durante 500ms: con una CPU lenta o un paquete grande se podía
   * agotar el plazo y el enlace compartido abría la página por arriba.
   *
   * Ahora el scroll lo hace la propia página una vez montada, así que no
   * depende del tiempo. Ralentizar la CPU lo demuestra.
   */
  test.skip(browserName !== 'chromium', 'la ralentización de CPU es de CDP');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.goto('/home#coleccion');

  const ancla = page.locator('#coleccion');
  await expect(ancla).toBeInViewport();

  await cdp.detach();
});

/* --- E. Usuario perdido --- */

test('E · las rutas inexistentes caen en la 404, que tiene salida', async ({ page }) => {
  for (const ruta of ['/ruta-que-no-existe', '/casos-de-uso/no-existe']) {
    await page.goto(ruta);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('no existe');
    // Dice qué se pidió: sin eso, la 404 no ayuda a ver si es un typo.
    await expect(page.getByText(ruta, { exact: false })).toBeVisible();

    await page.getByRole('link', { name: 'Ir a Inicio' }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Pregunta a tus documentos',
    );
  }
});

test('E2 · la 404 lista las secciones y cualquiera de ellas funciona', async ({
  page,
}) => {
  await page.goto('/no-existe');

  // Lista directa, no buscador: con tres secciones caben todas de un vistazo.
  const lista = page.getByRole('main').getByRole('list').last();
  await expect(lista.getByRole('listitem')).toHaveCount(RUTAS_NAV.length);

  await lista.getByRole('link', { name: /Arquitectura/ }).click();
  await expect(page).toHaveURL(/\/arquitectura$/);
});

/* --- F. Historial --- */

test('F · atrás y adelante dejan URL, contenido y enlace activo coherentes', async ({
  page,
}) => {
  await page.goto('/home');
  await navegarA(page, 'Arquitectura');
  await navegarA(page, 'Tecnologías');
  await navegarA(page, 'Inicio');

  /*
   * El enlace activo se comprueba con una aserción de locator y no muestreando
   * `textContent()` una vez: `aria-current` lo repinta React después de que
   * cambie la URL, así que una sola muestra pasa sola y falla dentro de la
   * tanda. `toHaveText` reintenta hasta que se asienta.
   */
  const activo = page
    .getByRole('navigation', { name: 'Principal' })
    .locator('[aria-current="page"]');

  // Estado de partida.
  await expect(page).toHaveURL(/\/home$/);
  await expect(activo).toHaveText('Inicio');

  await page.goBack(); // → /tecnologias
  await expect(page).toHaveURL(/\/tecnologias$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Qué hay instalado',
  );
  await expect(activo).toHaveText('Tecnologías');

  await page.goBack(); // → /arquitectura
  await expect(page).toHaveURL(/\/arquitectura$/);
  await expect(activo).toHaveText('Arquitectura');

  await page.goBack(); // → /home
  await expect(page).toHaveURL(/\/home$/);
  await expect(activo).toHaveText('Inicio');

  await page.goForward(); // → /arquitectura
  await expect(page).toHaveURL(/\/arquitectura$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Siete piezas');
  await expect(activo).toHaveText('Arquitectura');
});

/* --- G. Móvil --- */

test('G · el menú móvil navega, se cierra y devuelve el foco', async ({ page }) => {
  test.skip(!esMovil(page), 'el menú solo existe por debajo de 768px');

  await page.goto('/home');
  const boton = page.getByRole('button', { name: /abrir el menú/i });
  await expect(boton).toHaveAttribute('aria-expanded', 'false');

  await boton.click();
  await expect(boton).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('dialog', { name: 'Navegación' });
  await expect(menu).toBeVisible();

  // Navegar lo cierra.
  await menu.getByRole('link', { name: 'Arquitectura', exact: true }).click();
  await expect(page).toHaveURL(/\/arquitectura$/);
  await expect(menu).toBeHidden();
  await expect(boton).toHaveAttribute('aria-expanded', 'false');

  // Escape también, y el foco vuelve al botón que lo abrió.
  await boton.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(boton).toBeFocused();
});

/* --- H. Teclado --- */

test('H · se llega de Inicio a Tecnologías solo con teclado, y el foco cae en el h1', async ({
  page,
}) => {
  test.skip(esMovil(page), 'el recorrido con Tab se valida en escritorio');

  await page.goto('/home');
  await page.locator('h1').waitFor();

  // Primera parada: el enlace de salto. Es lo que evita atravesar la barra
  // entera en cada página.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /saltar al contenido/i })).toBeFocused();

  // Tabular hasta el enlace de Tecnologías de la barra y entrar.
  const destino = page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Tecnologías', exact: true });

  for (
    let i = 0;
    i < 20 && !(await destino.evaluate((el) => el === document.activeElement));
    i += 1
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(destino).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/tecnologias$/);
  // El foco aterriza en el h1 de la página nueva: sin esto, el siguiente Tab
  // seguiría por la barra y nunca llegaría al contenido.
  await expect(page.locator('h1')).toBeFocused();
});

/* --- Propuestas de UX implementadas --- */

test('UX1 · la aplicación tiene salida y devuelve a donde estabas', async ({ page }) => {
  // Se entra al sitio por Arquitectura para comprobar que vuelve ahí y no a
  // la portada: mandar siempre a /home obliga a repetir el camino.
  await page.goto('/arquitectura');
  await abrirElAgente(page);

  await expect(page).toHaveURL(/\/app$/);

  const volver = page.getByRole('link', { name: /volver al sitio|^sitio$/i });
  await expect(volver).toBeVisible();
  await volver.click();

  await expect(page).toHaveURL(/\/arquitectura$/);
});

test('UX1b · entrando directo a la aplicación, la salida lleva a la portada', async ({
  page,
}) => {
  // Sin haber pasado por el sitio no hay nada que recordar.
  await page.goto('/app');
  await page.getByRole('link', { name: /volver al sitio|^sitio$/i }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test('UX2 · arquitectura y tecnologías se enlazan en los dos sentidos', async ({
  page,
}) => {
  await page.goto('/arquitectura/qdrant');

  const panel = page.getByRole('complementary', { name: /detalle de qdrant/i });
  await panel.getByRole('link', { name: /Vector DB/ }).click();

  await expect(page).toHaveURL(/\/tecnologias\?capa=vector-db$/);
  await expect(page.getByText(/en Vector DB/)).toBeVisible();

  // Y el camino de vuelta: de la capa a la pieza del diagrama.
  await page
    .getByRole('link', { name: /^Qdrant/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/arquitectura\/qdrant$/);
  await expect(
    page.getByRole('complementary', { name: /detalle de qdrant/i }),
  ).toBeVisible();
});

test('UX3 · copiar el enlace a una pieza avisa de que lo ha copiado', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'el permiso de portapapeles es de Chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/arquitectura/qdrant');
  const panel = page.getByRole('complementary', { name: /detalle de qdrant/i });

  await panel.getByRole('button', { name: /copiar enlace a esta pieza/i }).click();

  // La confirmación va por `aria-live`: quien no ve el icono también se entera.
  await expect(page.getByRole('status')).toHaveText('Enlace copiado');

  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiado).toMatch(/\/arquitectura\/qdrant$/);
});
