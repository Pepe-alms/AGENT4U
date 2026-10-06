import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

/**
 * ESLint, y SOLO para las pruebas de punta a punta.
 *
 * El proyecto lintea `src/` con oxlint, que es mucho mas rapido. Pero oxlint
 * no tiene reglas de Playwright, y son justo las que hacen falta: cuatro veces
 * se ha colado una asercion sin espera o una medida a mitad de animacion, y
 * cada vez costo una sesion entera encontrarla. Estas reglas lo convierten en
 * un error de lint en vez de en un fallo intermitente.
 *
 * Por eso el `files` acotado: eslint no mira `src/` y los dos linters no se
 * pisan.
 */
export default tseslint.config({
  files: ['pruebas-e2e/**/*.ts'],
  extends: [...tseslint.configs.recommended, playwright.configs['flat/recommended']],
  rules: {
    // Las aserciones web-first reintentan solas. `textContent()` o
    // `isVisible()` muestrean UNA vez, y una sola muestra sobre algo que React
    // acaba de repintar es exactamente el falso fallo que nos ha pasado.
    'playwright/prefer-web-first-assertions': 'error',

    // Un `waitForTimeout` es adivinar un plazo: pasa en tu maquina y falla en
    // una lenta, o al reves. Si hay que esperar a algo, se espera a ESE algo.
    'playwright/no-wait-for-timeout': 'error',

    // `force: true` salta las comprobaciones de visibilidad y de estabilidad.
    // Si hace falta, es que el elemento no esta listo: eso es el fallo.
    'playwright/no-force-option': 'error',

    // Los `ElementHandle` no se revalidan: si el nodo se reemplaza, el handle
    // apunta a un huerfano. Los locators vuelven a resolver en cada accion.
    'playwright/no-element-handle': 'error',

    // Una asercion sin `await` no falla nunca: pasa siempre, en silencio.
    'playwright/missing-playwright-await': 'error',

    /* --- Reglas del plugin que aqui no aplican, y por que --- */

    // Nuestros saltos son condicionales y con motivo: `test.skip(esMovil,
    // 'la paleta se abre con un atajo de teclado')`. Eso no es una prueba
    // desactivada y olvidada, es una que no aplica a esa plataforma.
    'playwright/no-skipped-test': 'off',

    // Las pruebas transversales se GENERAN a partir de `src/routes.ts`, asi
    // que tienen que ramificar: una ruta que no sale en la barra no puede
    // afirmar nada sobre el enlace activo. La alternativa es escribir las
    // rutas a mano, que es justo lo que no queremos.
    'playwright/no-conditional-in-test': 'off',
    'playwright/no-conditional-expect': 'off',

    // `page.setInputFiles` no tiene equivalente en locator para lo que hace
    // aqui, que es soltar un fichero en la zona de arrastre.
    'playwright/prefer-locator': 'off',
  },
});
