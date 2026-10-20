# AGENT4U

RAG agéntico sobre documentos propios. Backend FastAPI + Qdrant, frontend
React + Vite. El frontend sirve dos cosas: un sitio editorial en `/` y la
aplicación del agente en `/app`.

## Comandos

```
cd frontend && npm run verificar   # typecheck, lint, formato, unidad y e2e
cd frontend && npm run test:e2e    # solo punta a punta, Chrome + iPhone
cd backend  && uv run uvicorn app.api.main:app --reload
```

## Reglas de tests e2e

Estas reglas existen porque **cuatro veces** se coló un falso fallo que costó
media sesión encontrar: una aserción que medía una vez algo que React acababa
de repintar, o una medida tomada a mitad de una animación. Las cinco primeras
están forzadas por `eslint-plugin-playwright` como **error**, así que ya no
dependen de acordarse.

## Solo aserciones web-first

Reintentan solas hasta que la condición se cumple o se agota el plazo:
`toHaveText`, `toBeVisible`, `toHaveURL`, `toHaveAttribute`, `toHaveCount`,
`toBeInViewport`, `toBeFocused`.

```ts
// NO: una sola muestra sobre algo que se asienta de forma asíncrona.
expect(await enlace.textContent()).toBe('Inicio');
if (await panel.isVisible()) { … }

// SÍ:
await expect(enlace).toHaveText('Inicio');
await expect(panel).toBeVisible();
```

Si hay que comprobar algo que no tiene aserción propia, `expect.poll()`, que
también reintenta.

## Nada de `waitForTimeout`

Un plazo fijo es adivinar: pasa en tu máquina y falla en una lenta, o al revés.
Si hay que esperar a algo, se espera a **ese** algo.

Caso real: la auditoría de axe llevaba `waitForTimeout(1200)` para dejar acabar
las animaciones de entrada. La solución no era afinar el número, era
`reducedMotion: 'reduce'` en la configuración, que hace que no haya animación
que esperar.

## Nada de `force: true` ni `ElementHandle`

`force` salta las comprobaciones de visibilidad y estabilidad. Si hace falta,
es que el elemento no está listo: **eso** es el fallo, no la comprobación.

Un `ElementHandle` no se revalida: si el nodo se reemplaza, apunta a un
huérfano. Los locators vuelven a resolver en cada acción.

## Selectores por rol y nombre, acotados a una región

```ts
// NO: "Arquitectura" sale en la barra, en el contenido y en el pie.
page.getByRole("link", { name: "Arquitectura" });

// SÍ:
page
  .getByRole("navigation", { name: "Principal" })
  .getByRole("link", { name: "Arquitectura", exact: true });
page
  .getByRole("main")
  .getByRole("link", { name: /Arquitectura.*siete piezas/s });
```

Regiones disponibles: `main`, `navigation` (con su `aria-label`),
`contentinfo` (el pie), `complementary` (los paneles laterales).

## Esperar a la página nueva, no a un `h1` cualquiera

React Router envuelve las navegaciones en una transición: mientras llega el
paquete diferido, **la página anterior sigue montada**, con su propio `h1` y
sus propios enlaces. Esperar a `locator('h1')` encuentra el viejo.

```ts
await enlace.click();
await expect(page).toHaveURL(/\/tecnologias$/);
await expect(page.locator("h1")).not.toHaveText(titularAnterior);
```

## Qué NO cubren estas pruebas

Con `reducedMotion: 'reduce'` se valida el estado final, no las transiciones.
Es un intercambio aceptado: comprobar el aspecto de una animación no es para lo
que sirven. Si algún día hace falta, se hace en un proyecto aparte con el
movimiento activado.
