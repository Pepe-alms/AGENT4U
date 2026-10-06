import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  RUTAS,
  RUTAS_VISITABLES,
  migasDe,
  rutaPorId,
  tituloDocumento,
} from '../src/routes';

/**
 * Lo transversal: lo que tiene que cumplir CADA ruta.
 *
 * Las pruebas se generan a partir de `src/routes.ts`, que es la misma lista de
 * la que salen la barra, el pie y las migas. Añadir una ruta ahi la mete sola
 * en todas estas comprobaciones; escribirlas a mano seria tener una cuarta
 * lista que mantener, y la primera que se olvida de actualizar.
 */

/** Recoge los errores de consola de una pagina. El array se lee despues. */
function vigilarConsola(page: Page): string[] {
  const problemas: string[] = [];
  page.on('console', (mensaje) => {
    const tipo = mensaje.type();
    if (tipo === 'error' || tipo === 'warning')
      problemas.push(`${tipo}: ${mensaje.text()}`);
  });
  page.on('pageerror', (error) => problemas.push(`pageerror: ${error.message}`));
  return problemas;
}

test.describe('cada ruta del mapa', () => {
  for (const ruta of RUTAS.filter((r) => RUTAS_VISITABLES.includes(r.path))) {
    test(`${ruta.path} responde, se titula y tiene un solo h1`, async ({ page }) => {
      const problemas = vigilarConsola(page);

      // Recargar directamente en la ruta: es lo que hace un enlace compartido,
      // y lo que da 404 si falta el fallback SPA del servidor.
      const respuesta = await page.goto(ruta.path);
      expect(respuesta?.status(), `status de ${ruta.path}`).toBe(200);

      await expect(page).toHaveTitle(tituloDocumento(ruta.title));

      const descripcion = page.locator('meta[name="description"]');
      await expect(descripcion).toHaveAttribute('content', ruta.description);

      // Un solo h1 por pagina: dos convierten el esquema del documento en algo
      // que un lector de pantalla no puede recorrer.
      await expect(page.locator('h1')).toHaveCount(1);

      // El enlace de la barra que corresponde esta marcado, y solo ese.
      const barra = page.getByRole('navigation', { name: 'Principal' });
      const activos = barra.locator('[aria-current="page"]');
      if (ruta.showInNav) {
        await expect(activos).toHaveCount(1);
        await expect(activos).toHaveText(ruta.label);
      }

      // Migas coherentes con el mapa.
      const cadena = migasDe(ruta.id);
      const migas = page.getByRole('navigation', { name: 'Migas de pan' });
      if (cadena.length > 1) {
        await expect(migas).toBeVisible();
        for (const paso of cadena) await expect(migas).toContainText(paso.label);
      } else {
        await expect(migas).toHaveCount(0);
      }

      expect(problemas, `consola limpia en ${ruta.path}`).toEqual([]);
    });

    test(`${ruta.path} no tiene violaciones serious ni critical`, async ({ page }) => {
      await page.goto(ruta.path);
      // Se espera al h1 para no auditar el esqueleto de carga de la pagina
      // diferida, que no es lo que ve el usuario.
      await page.locator('h1').waitFor();

      /*
       * No hace falta esperar a que acaben animaciones: la configuración pone
       * `reducedMotion: 'reduce'` en todos los proyectos, así que el revelado
       * se pinta directamente en su estado final. Antes había aquí una espera
       * de 1,2 s porque axe medía elementos a mitad del fade y reportaba
       * `color-contrast` sobre una opacidad transitoria.
       */

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const graves = violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        graves.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
        `axe en ${ruta.path}`,
      ).toEqual([]);
    });
  }
});

test('ningún enlace interno lleva a la 404', async ({ page }) => {
  const visitadas = new Set<string>();
  const porVisitar = ['/home'];
  const rotos: string[] = [];

  while (porVisitar.length > 0) {
    const ruta = porVisitar.pop()!;
    if (visitadas.has(ruta)) continue;
    visitadas.add(ruta);

    await page.goto(ruta);
    await page.locator('h1').waitFor();

    // Que esta ruta no sea ya la 404.
    const titular = await page.locator('h1').textContent();
    if (titular?.includes('no existe')) rotos.push(ruta);

    const destinos = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href') ?? '')
        // Internas, sin el enlace de salto ni la aplicación, que es otro árbol.
        .filter((h) => h.startsWith('/') && !h.startsWith('//') && h !== '/app'),
    );

    for (const destino of destinos) {
      const limpio = destino.split('#')[0]!.split('?')[0]!;
      if (!visitadas.has(limpio)) porVisitar.push(limpio);
    }
  }

  expect(rotos, 'rutas enlazadas que acaban en la 404').toEqual([]);
  // El recorrido tiene que haber llegado a todas las secciones de la barra.
  for (const ruta of RUTAS_VISITABLES) {
    expect([...visitadas], `el crawler llegó a ${ruta}`).toContain(ruta);
  }
});

test('ningún enlace interno usa <a href> en vez del router', async ({ page }) => {
  await page.goto('/home');
  await page.locator('h1').waitFor();

  // Se marca el documento: si un enlace recarga la página, la marca se pierde.
  await page.evaluate(() => {
    (window as unknown as { __mismaPagina?: boolean }).__mismaPagina = true;
  });

  // El enlace del PIE y no el de la barra: la barra superior está oculta por
  // debajo de 768px, así que en móvil el selector no encontraba nada. El pie
  // está en todas las medidas y es igual de interno.
  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Arquitectura', exact: true })
    .click();
  await page.locator('h1').waitFor();

  const sobrevive = await page.evaluate(
    () => (window as unknown as { __mismaPagina?: boolean }).__mismaPagina === true,
  );
  expect(sobrevive, 'la navegación de la barra recargó la página entera').toBe(true);
});

test('no hay enlaces vacíos ni externos sin rel', async ({ page }) => {
  const fallos: string[] = [];

  for (const ruta of RUTAS_VISITABLES) {
    await page.goto(ruta);
    await page.locator('h1').waitFor();

    const malos = await page.evaluate(() =>
      [...document.querySelectorAll('a')].flatMap((a) => {
        const href = a.getAttribute('href') ?? '';
        const texto = (a.textContent ?? '').trim().slice(0, 30);
        if (href === '' || href === '#') return [`vacío: «${texto}»`];
        const externo = /^https?:\/\//.test(href);
        if (externo && a.target === '_blank') {
          const rel = a.getAttribute('rel') ?? '';
          if (!rel.includes('noopener') || !rel.includes('noreferrer')) {
            return [`externo sin rel: ${href}`];
          }
        }
        return [];
      }),
    );
    fallos.push(...malos.map((m) => `${ruta} → ${m}`));
  }

  expect(fallos).toEqual([]);
});

test('/ redirige a /home sin dejar entrada en el historial', async ({ page }) => {
  await page.goto('/tecnologias');
  await page.locator('h1').waitFor();

  await page.goto('/');
  await expect(page).toHaveURL(/\/home$/);

  // Atrás tiene que devolver a /tecnologias. Si la redirección dejase entrada,
  // volvería a / y de ahí otra vez a /home: un bucle del que no se sale.
  await page.goBack();
  await expect(page).toHaveURL(/\/tecnologias$/);
});

test('una ruta inexistente muestra la 404 y no una página en blanco', async ({
  page,
}) => {
  const respuesta = await page.goto('/ruta-que-no-existe');
  // El servidor devuelve 200 con la SPA; quien dice que no existe es la app.
  expect(respuesta?.status()).toBe(200);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('no existe');
  await expect(page).toHaveTitle(tituloDocumento(rutaPorId('no-encontrada')!.title));
});
