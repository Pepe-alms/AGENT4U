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
    /*
     * Movimiento reducido en TODAS las pruebas.
     *
     * No es por comodidad: con el revelado al hacer scroll activo, cualquier
     * elemento situado debajo de contenido que entra en pantalla se esta
     * moviendo, y Playwright espera a que se estabilice antes de pulsarlo.
     * Eso produjo cuatro falsos fallos y un recorrido que no se podia
     * completar. Con esto, lo que se prueba es el estado final, que es el
     * unico sobre el que tiene sentido afirmar algo.
     *
     * Lo que se pierde: las animaciones en si no quedan cubiertas. Es un
     * intercambio aceptado, porque validar el aspecto de una transicion no es
     * para lo que sirven estas pruebas.
     */
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chrome',
      // El Chrome ya instalado, en vez de descargar Chromium aparte.
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        // Aísla el estado del backend de mentira de este proyecto del otro:
        // los dos corren a la vez contra el mismo servidor. Ver
        // `estadoDe()` en pruebas-e2e/servidor-falso.mjs.
        extraHTTPHeaders: { 'x-sesion-prueba': 'chrome' },
      },
    },
    {
      /*
       * iPhone 13 con WebKit de verdad, que es el motor de Safari.
       *
       * Importa por dos cosas a la vez: el menú de navegación es otro
       * componente por debajo de 768px, y WebKit es el único motor del iPhone.
       * Antes esto corría sobre Chromium con el viewport del iPhone, lo que
       * validaba la medida pero no el motor.
       *
       * Requiere `npx playwright install webkit` una vez.
       */
      name: 'iphone',
      use: {
        ...devices['iPhone 13'],
        extraHTTPHeaders: { 'x-sesion-prueba': 'iphone' },
      },
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
