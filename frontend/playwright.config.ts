import { defineConfig, devices } from '@playwright/test';

const PUERTO_APP = 5178;
const PUERTO_API = 8099;

export default defineConfig({
  testDir: './pruebas-e2e',
  // En local interesa ver el primer fallo; en CI, reintentar una vez absorbe
  // el ruido de arranque sin tapar un fallo de verdad.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PUERTO_APP}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      // El Chrome ya instalado, en vez de descargar ~1 GB de navegadores.
      // Para añadir Firefox o WebKit haría falta `npx playwright install`.
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      /*
       * El móvil importa aquí de verdad: el menú de navegación es otro
       * componente por debajo de 768px, no el mismo encogido.
       *
       * `defaultBrowserType: 'chromium'` sobrescribe el WebKit que trae el
       * perfil de iPhone, porque el proyecto no descarga navegadores: usa el
       * Chrome ya instalado. Lo que se valida es el viewport, el táctil y el
       * user agent, NO el motor: un fallo específico de Safari no se vería
       * aquí. Para cubrirlo haría falta `npx playwright install webkit` y
       * quitar estas dos líneas.
       */
      name: 'iphone',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: 'chrome' },
    },
  ],
  // Playwright levanta las dos piezas y las apaga al terminar, para que
  // `npm run test:e2e` funcione sin preparar nada a mano.
  webServer: [
    {
      command: `node pruebas-e2e/servidor-falso.mjs ${PUERTO_API}`,
      url: `http://localhost:${PUERTO_API}/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Se prueba el build, no el servidor de desarrollo: es lo que se
      // publica. `vite preview` sirve index.html para las rutas que no son un
      // fichero, que es lo que permite recargar en /arquitectura sin un 404.
      // En producción eso lo hace nginx: ver despliegue/nginx.conf.
      command: `npm run build && npx vite preview --port ${PUERTO_APP} --strictPort`,
      url: `http://localhost:${PUERTO_APP}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_API_URL: `http://localhost:${PUERTO_API}` },
    },
  ],
});
