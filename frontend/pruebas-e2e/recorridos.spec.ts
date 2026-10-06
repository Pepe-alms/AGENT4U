import { expect, test, type Page } from '@playwright/test';

/**
 * Los recorridos que haria una persona.
 *
 * A diferencia de `rutas.spec.ts`, que comprueba propiedades de cada ruta por
 * separado, aqui se encadenan pasos: lo que se valida es que el camino entero
 * funcione, no cada baldosa.
 */

const esMovil = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

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

  // Avanzar con "Siguiente" hasta que ya no haya. El tope evita que un
  // encadenado circular deje la prueba dando vueltas para siempre.
  const visitadas: string[] = [];
  for (let paso = 0; paso < 10; paso += 1) {
    visitadas.push(new URL(page.url()).pathname);

    const siguiente = page
      .getByRole('navigation', { name: 'Recorrido del sitio' })
      .getByRole('link', { name: /siguiente/i });
    if ((await siguiente.count()) === 0) break;

    // Sin `scrollIntoViewIfNeeded`: `click()` ya desplaza, y además reintenta
    // si el nodo se reemplaza entre la resolución y la acción. Pedir el
    // desplazamiento aparte abre una ventana en la que el elemento puede
    // quedarse huérfano —el mismo patrón que el fallo de las citas de la
    // iteración 022—.
    await siguiente.click();
    await page.locator('h1').waitFor();
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

  const ancla = page.locator('#coleccion');
  await expect(ancla).toBeVisible();

  // En el viewport: un hash que cambia la URL y deja la página arriba es
  // exactamente el fallo que esta prueba vigila.
  await expect
    .poll(async () => {
      const caja = await ancla.boundingBox();
      const alto = page.viewportSize()?.height ?? 900;
      return caja !== null && caja.y < alto && caja.y > -caja.height;
    })
    .toBe(true);
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

test('E2 · el buscador de la 404 encuentra una sección', async ({ page }) => {
  await page.goto('/no-existe');
  await page.getByLabel(/buscar una sección/i).fill('arquitect');

  await expect(page.getByText(/1 sección para/)).toBeVisible();
  // Acotado al resultado: "Arquitectura" aparece tambien en la barra y en el
  // pie, y sin acotar el selector resuelve a tres enlaces.
  await page
    .getByRole('main')
    .getByRole('link', { name: /Arquitectura.*siete piezas/s })
    .click();
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
