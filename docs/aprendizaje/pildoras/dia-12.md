# Píldora 12 — Herramientas y estructura del frontend

**Miércoles 11-nov-2026 · 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 11

No hay entrega del día 11: en `origin/aprendizaje` no existe `entregas/dia-11.md` y en el remoto no hay ninguna rama `ejercicio/dia-*`. Tampoco ha llegado tarde ninguna de las anteriores (02 a 10). Sin nota.

Hoy cruzamos al frontend y el ejercicio no depende de nada atrasado: no necesitas Python, ni el backend, ni el gateway. Usarás el **servidor falso** que ya trae el repo para las pruebas e2e, que imita al gateway.

`main` sigue en `fb93eea` (21-oct). Todo lo de esta píldora lo he comprobado hoy contra ese código, con las versiones instaladas por `npm ci` desde `package-lock.json`: `vite 8.2.2` (con **Rolldown** como empaquetador), `react 19.2.8`, `react-router 7.18.4`, `typescript 6.0.3` y `knip 6.40.0`. Las cifras de tamaño y las salidas pegadas son reales: he hecho el ejercicio entero antes de escribirlo.

---

## 1. Concepto clave: qué hace Vite y qué hace TypeScript (y qué no)

### 1.1 Dos modos que no se parecen en nada

Vite tiene dos caras, y confundirlas es el origen de la mitad de los "en mi máquina funciona":

| | `npm run dev` (`vite`) | `npm run build` (`tsc -b && vite build`) |
|---|---|---|
| Qué produce | Nada en disco. Un servidor en `:5173`. | La carpeta `dist/`: `index.html` + `assets/*.js|css|woff2` con hash. |
| Cómo sirve el código | **Un módulo por fichero**, tal cual lo pide el navegador con `import`. Vite transforma cada `.tsx` a JS al vuelo (quita tipos y JSX) y reescribe los `import` (`@/x` → `/src/x.ts`). | **Empaqueta**: junta los módulos en *chunks*, minifica, parte por `import()` dinámicos y añade hash al nombre. |
| Tipos | **No los comprueba.** Solo los borra. Un error de tipos no impide que la página cargue. | `tsc -b` **sí** los comprueba antes, y si falla no hay build. |
| `import.meta.env` | Inyecta un objeto al principio de cada módulo que lo usa. | **Sustituye el texto** por el valor literal. Queda "cocinado" dentro del JS. |
| Rutas tipo `/app` | Sirve `index.html` para cualquier ruta que no sea un fichero. | Nada: eso es cosa del servidor (nginx en producción, `vite preview` en las e2e). |

La idea fuerza: **en desarrollo no hay bundle**. El navegador moderno entiende módulos ES, así que Vite solo transforma ficheros sueltos bajo demanda. Por eso arranca en 0,4 s aunque el proyecto tenga 89 ficheros de código. El empaquetado solo existe al construir, y es ahí donde se toman las decisiones que ve el usuario: qué se descarga primero y qué se pide después.

### 1.2 Variables `VITE_*`: se fijan al construir, no al ejecutar

Vite solo expone al código de cliente las variables que empiezan por `VITE_`. Las lee, por orden de prioridad de mayor a menor:

1. Las **variables del proceso** (`VITE_API_URL=... npm run build`).
2. `.env.[modo].local`, `.env.[modo]` (en `vite build` el modo es `production`).
3. `.env.local`, `.env`.

Y luego hace una sustitución de texto. `import.meta.env.VITE_API_URL` no es una lectura en tiempo de ejecución: después del build, en el JS solo queda la cadena `` `/api` ``. Dos consecuencias que hay que tener grabadas:

- **No hay secretos posibles.** Todo `VITE_*` acaba en texto plano en un fichero público.
- **Una imagen Docker sirve para un único destino.** Si quieres el mismo build en *staging* y en producción con URLs distintas, no puedes: hay que reconstruir. AGENT4U esquiva el problema con una URL **relativa** (`/api`), que vale en cualquier dominio porque nginx está en el mismo origen.

### 1.3 `tsc -b` y los *project references*

`tsconfig.json` no compila nada (`"files": []`). Solo apunta a dos proyectos:

- `tsconfig.app.json`: el código del navegador (`include: ["src"]`, `lib: DOM`, tipos de `vite/client`).
- `tsconfig.node.json`: el código que corre en Node (`include: ["vite.config.ts"]`, tipos de `node`).

`tsc -b` ("build mode") comprueba los dos. Con `noEmit: true`, TypeScript **no genera JS**: solo es un comprobador de tipos. Quien genera el JS es Vite. Esto es lo normal con un empaquetador moderno, pero significa que **lo que no esté en ningún `include` no lo comprueba nadie**. Lo vas a medir en el ejercicio.

### 1.4 El router "de datos" de React Router 7

`createBrowserRouter([...])` recibe un **árbol de objetos ruta** (`path`, `element`, `children`, `handle`). Una ruta sin `path` pero con `element` y `children` es un **layout**: pinta su `element`, y dentro de él, en el `<Outlet />`, la hija que case. `handle` es un hueco libre para colgar datos propios de la ruta, y `useMatches()` devuelve las rutas que casan, de la raíz a la hoja, con sus `handle`. Así un layout sabe "qué página estoy enseñando" sin que la página se lo diga.

---

## 2. Cómo está en AGENT4U

### 2.1 El mapa de carpetas

```text
frontend/
├── index.html                 43 l.  #root, favicon y un <script> síncrono que pone el tema antes de pintar
├── vite.config.ts             33     plugins react + tailwind, alias @, config de vitest, puerto fijo
├── tsconfig.json / .app / .node      project references (§1.3)
├── package.json               55     scripts: dev, build, typecheck, lint, test, test:e2e, verificar, limpieza
├── .env.example / .env.production    VITE_API_URL: localhost:8080 en dev, /api en build
├── knip.json                  15     qué es punto de entrada y qué es proyecto, para detectar código muerto
├── Dockerfile                 20     node:20-alpine compila → nginx:1.27-alpine sirve
├── despliegue/nginx.conf      58     SPA con fallback + proxy /api/ → gateway:8080
├── herramientas/comprobar-bundle.mjs  busca en dist/ lo que no debe publicarse
├── pruebas-e2e/               Playwright + servidor-falso.mjs (un gateway de mentira)
└── src/
    ├── main.tsx               17     createRoot → <StrictMode><Animacion><Raiz/></Animacion></StrictMode>
    ├── routes.ts             174     EL MAPA DE RUTAS del sitio (sin React a propósito)
    ├── app/        3 fich.   736 l.  Raiz (router), App (la aplicación /app), AppShell (layout de la app)
    ├── features/  24 fich.  3546 l.  ajustes, chat, comandos, conversaciones, documentos, salud
    ├── shared/    40 fich.  2785 l.  api, hooks, lib, styles, ui
    ├── sitio/     19 fich.  3119 l.  el sitio editorial: Sitio (layout), paginas/, componentes/, datos/
    └── pruebas/preparar.ts           setup de vitest (jest-dom)
```

Las cifras de `app/`, `features/`, `shared/` y `sitio/` excluyen los 11 ficheros `*.test.*` (88 tests en total, todos en verde hoy con `npx vitest run`).

**La regla de dependencias**, medida con `grep` sobre los `import '@/...'` de cada carpeta:

```text
app/      → features, shared, sitio, routes          (lo compone todo)
features/ → shared                                   (ninguna feature importa a otra)
sitio/    → shared, routes                           (no sabe que existe /app)
shared/   → shared                                   (no importa nada de arriba)
routes.ts → sitio/tipos (solo `import type`)
```

Es una arquitectura limpia de verdad: flechas en una sola dirección, `features` aisladas entre sí, `shared` sin dependencias hacia arriba. **Pero nada la hace cumplir.** `.oxlintrc.json` solo activa `rules-of-hooks` y `only-export-components`, y `eslint.config.js` mira únicamente `pruebas-e2e/`. Mañana alguien importa `@/features/chat/estado` desde `shared/lib` y nada salta.

### 2.2 El arranque: de `index.html` a la primera pantalla

1. `index.html:24-37` ejecuta un `<script>` **síncrono** que lee `agent4u:tema` y `agent4u:densidad` de `localStorage` y pone `data-tema`/`data-densidad` en `<html>`. Es para que no haya destello de tema equivocado: React aplicaría el tema en un efecto, después del primer fotograma.
2. `index.html:41` carga `/src/main.tsx` como módulo. En el build, Vite reescribe esa línea al chunk de entrada con hash.
3. `src/main.tsx` monta `<Raiz />` dentro de `StrictMode` (que **en desarrollo** ejecuta dos veces los efectos para destapar los que no se limpian) y de `<Animacion>`, que carga `motion` en diferido con `LazyMotion`.
4. `src/app/Raiz.tsx:62-109` define el router.

### 2.3 Dos árboles: el sitio y la aplicación

```ts
// src/app/Raiz.tsx:62-67 (resumido)
const router = createBrowserRouter([
  { path: RUTA_APP, element: <App /> },          // '/app': fuera del layout del sitio
  {
    element: <Sitio />,                           // layout sin path: barra, pie, migas
    children: [
      { path: '/', element: <Navigate to="/home" replace /> },
      { path: rutaPorId('home')!.path, element: diferida(Inicio), handle: handle('home') },
      // ... arquitectura (con hija ':componente'), tecnologias, '*'
    ],
  },
]);
```

- **`/app`** es la aplicación del agente. No tiene sub-rutas: todo lo que pasa dentro (abrir un hilo, el panel de fuentes, los ajustes) es estado de React, no URL.
- **El resto** cuelga de `<Sitio />`, que en `src/sitio/Sitio.tsx:180-186` usa `useMatches()` para encontrar el `handle.id` de la ruta más profunda y, con él, pone el `document.title` (línea 42) y marca la barra.
- **`src/routes.ts`** es la fuente de verdad: de ahí salen la barra, el pie, las migas, el "Anterior/Siguiente", el `<title>`, la `meta description` y la lista de rutas que recorren las pruebas e2e (`RUTAS_VISITABLES`). `Raiz.tsx` lee los `path` con `rutaPorId('home')!.path` en vez de escribirlos.
- `/arquitectura/:componente` es una **ruta hija con `element: null`**: el padre (`Arquitectura`) sigue montado y lee el parámetro con `useParams`. Abrir un nodo del diagrama cambia la URL sin volver a montar el diagrama.
- Las cuatro páginas del sitio llegan con `lazy(() => import(...))` (`Raiz.tsx:14-17`), envueltas en `<Suspense>` por `diferida()`. Cada una es un chunk aparte.

### 2.4 Herramientas: `vite.config.ts`, `tsconfig` y el alias `@/`

```ts
// vite.config.ts:8-14, 25-32
plugins: [react(), tailwindcss()],
resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
// ...
server: { port: 5173, strictPort: true },
```

El alias se declara **dos veces**: en `vite.config.ts` (para que Vite resuelva el import) y en `tsconfig.app.json:12` (`"paths": { "@/*": ["./src/*"] }`, para que TypeScript lo entienda). Si los desincronizas, o compila y no carga, o carga y no compila.

`strictPort: true` es una decisión fina: si el 5173 está ocupado, Vite **no arranca** en lugar de saltar al 5174. El gateway solo acepta CORS de `localhost:3000` y `localhost:5173` (`gateway/app/main.py:33`), así que un 5174 daría errores de CORS con pinta de backend roto.

`vite.config.ts` también lleva la configuración de Vitest (`defineConfig` se importa de `vitest/config`): `jsdom`, tests junto al código (`src/**/*.test.{ts,tsx}`) y `setupFiles`.

### 2.5 `VITE_API_URL`: los tres caminos

| Camino | Valor | De dónde sale |
|---|---|---|
| `npm run dev` | `http://localhost:8080` | `.env` (copia de `.env.example`) |
| `npm run build` | `/api` | `.env.production:16`, versionado y con prioridad sobre `.env` |
| `npm run test:e2e` | `http://localhost:8099` | `playwright.config.ts:79`, variable de proceso, que gana a todo |

Y en el código, un único punto de lectura:

```ts
// src/shared/api/cliente.ts:17, 27-30
const BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

function urlDe(ruta: string): string {
  if (!BASE_URL) throw new ErrorApi(MENSAJES.configuracion, 'configuracion');
  return `${BASE_URL}${ruta}`;
}
```

El `throw` va dentro de la función y no en el cuerpo del módulo a propósito: un error al importar tumbaría la app entera sin poder pintar nada; así llega a la UI como un `ErrorApi` de tipo `'configuracion'` con un mensaje que dice qué falta.

### 2.6 Producción: Dockerfile multietapa y nginx

```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY despliegue/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
```

La imagen final no tiene Node ni `node_modules`: solo ficheros estáticos y nginx. Copiar primero `package*.json` y luego `npm ci` aprovecha la caché de capas: si solo cambias código, Docker no reinstala dependencias. `.dockerignore` deja fuera `.env` y `.env.local` pero **no** `.env.production`, que es justo el que fija `/api`.

`despliegue/nginx.conf` hace tres cosas:

| Bloque | Qué hace | Por qué |
|---|---|---|
| `location /assets/` (23-27) | `expires 1y` + `immutable` | El nombre lleva hash: si cambia el contenido, cambia el nombre. Se puede cachear para siempre. |
| `location /api/` (41-51) | `proxy_pass http://gateway:8080/;` con `proxy_buffering off` | La **barra final** quita el prefijo: `/api/graphql` llega como `/graphql`. Sin búfer, el SSE de `/preguntar` llega token a token. |
| `location /` (54-57) | `try_files $uri $uri/ /index.html` + `no-cache` | Fallback de SPA: recargar en `/arquitectura` sirve `index.html` y React Router resuelve. `index.html` no se cachea porque es el que apunta a los hashes nuevos. |

### 2.7 Las dos redes de seguridad sobre el resultado

- **`herramientas/comprobar-bundle.mjs`** recorre `dist/` y falla si encuentra `localhost:<puerto>`, `127.0.0.1`, la cabecera de sesión de pruebas, el servidor falso, `debugger`, `console.log` o librerías de test. Nació porque se publicó un bundle con `http://localhost:8000` dentro: ningún typecheck ni test lo ve, porque el código era correcto y lo malo era el valor sustituido.
- **`knip`** busca ficheros, exports y dependencias sin usar. `knip.json` le dice cuáles son los puntos de entrada que no importa nadie (las páginas que se cargan con `import()`, los specs, las herramientas). Hoy `npx knip` completo sale limpio.

`npm run verificar` encadena typecheck → lint → prettier → vitest → e2e → build → comprobar-bundle. El orden importa: las e2e construyen apuntando a `localhost:8099`, así que el build de producción tiene que ir **después**, para que lo último en `dist/` sea lo publicable y además comprobado.

---

## 3. Por qué se montó así

**Vite y no Webpack/CRA.** Create React App está abandonado; Webpack empaqueta también en desarrollo, y en un proyecto de este tamaño eso son segundos por cambio. Vite da arranque instantáneo y HMR por módulo. El coste: dev y build son caminos distintos (transformación al vuelo con Oxc frente a empaquetado con Rolldown), y un fallo puede aparecer solo en uno de los dos. Por eso las e2e prueban **el build** con `vite preview`, no el servidor de desarrollo (`playwright.config.ts:71-79`).

**`features/` + `shared/` y no carpetas por tipo** (`components/`, `hooks/`, `services/`). Agrupar por funcionalidad hace que todo lo del chat esté en un sitio y que borrar una feature sea borrar una carpeta. `shared/` es lo que no pertenece a ninguna. Es la idea de *feature-sliced design* en versión ligera. El coste es disciplina: la frontera solo existe mientras nadie la cruce, y hoy no hay herramienta que lo impida.

**Un mapa de rutas en datos (`routes.ts`) separado del router (`Raiz.tsx`).** Si la barra, el pie, las migas y las pruebas leyeran cada uno su lista, acabarían desincronizados. Con una sola lista, añadir una página es una entrada nueva. `routes.ts` no importa React para que Playwright lo pueda importar sin arrastrar JSX. El coste: dos ficheros que hay que tocar a la vez (el dato y el `element`), unidos por un `id` de texto y un `!` de no-nulo que, si te equivocas de id, revienta al cargar el módulo.

**URL relativa `/api` + nginx en el mismo origen.** Elimina CORS en producción y hace la imagen independiente del dominio. Las alternativas eran una URL absoluta por entorno (una imagen por entorno) o un `config.js` que nginx genere al arrancar con `envsubst` (configuración en ejecución, más piezas). Para un solo despliegue, la relativa es lo más simple que funciona.

**Por qué `/app` no es lazy.** El `git log` lo explica: hasta `2708dec` ("Feat/navegacion", 19-oct) `main.tsx` montaba `<App/>` directamente y no había router. Ese commit añadió el sitio editorial, `routes.ts` y `Raiz.tsx` **alrededor** de la App existente, y las páginas nuevas nacieron lazy; la App vieja se quedó con su `import` estático.

### Cosas que no cuadran

- 🔴 **Quien entra en `/home` se descarga la aplicación entera.** `Raiz.tsx:5` importa `App` de forma estática, así que el chat, la paleta, los ajustes, los paneles y sus iconos van en el chunk de entrada. Comprobado: la cadena `Nueva conversación` está en `dist/assets/index-*.js`, que se carga en todas las rutas. El comentario de `Raiz.tsx:10-12` ("quien entra por la portada no se descarga el diagrama...") es verdad para el diagrama, pero se descarga algo mucho más grande. Medido hoy: **449,6 kB de JS inicial (146,1 kB gzip)**. Con `App` lazy: **363,8 kB (119,9 kB gzip)**, un 18 % menos. Lo arreglas en el ejercicio.
- 🟠 **Comentarios que siguen hablando del backend.** `.env.production:13-15` dice "nginx proxea /api/ **al backend**" y `cliente.ts:7-8` "la ruta que nginx proxea **al backend**". Desde `fb93eea` el proxy va al **gateway** (`nginx.conf:42`). Lo curioso es que `.env.production` nació en ese mismo commit. `vite.config.ts:26-27` justifica `strictPort` con el CORS de `backend/app/api/main.py:10`, cuando el que importa es el del gateway (`gateway/app/main.py:33`; la lista es la misma, así que la conclusión vale). Y el `README.md` dice que el sitio vive en `/`, cuando `/` redirige a `/home`.
- 🟠 **`tsc -b` no comprueba ni las e2e ni su configuración.** `tsc -b --listFiles` fuera de `src/` solo lista `vite.config.ts`. `playwright.config.ts`, `pruebas-e2e/*.spec.ts` y `herramientas/*.mjs` no están en ningún `include`. ESLint mira los specs, pero `tseslint.configs.recommended` no comprueba tipos. Un `page.goto(123)` en un spec solo fallaría al ejecutarlo.
- 🟠 **`import.meta.env` es `any`.** No hay `src/vite-env.d.ts` que declare `ImportMetaEnv`, y los tipos de Vite caen en `Record<string, any>`. El `: string | undefined` de `cliente.ts:17` es una anotación manual: `import.meta.env.VITE_API_ULR` (con la errata) compila sin queja. Arreglo: declarar `interface ImportMetaEnv { readonly VITE_API_URL?: string }` y activar `strictImportMetaEnv` en `ViteTypeOptions` (Vite 8 ya lo soporta).
- 🟡 **`node:20-alpine` está fuera de soporte.** Node 20 llegó a fin de vida el 30-abr-2026: sin parches de seguridad. Vite 8 aún lo acepta (`^20.19.0 || >=22.12.0`), y tú desarrollas con Node 22. El build de producción usa una versión distinta de la tuya. `nginx:1.27` es además una rama *mainline* ya cerrada.
- 🟡 **nginx sin compresión.** `nginx.conf` no activa `gzip`, y la configuración principal de la imagen oficial lo trae comentado (`#gzip on;`). Se servirían los 450 kB en crudo en lugar de 146 kB. Compruébalo con `docker run --rm nginx:1.27-alpine grep gzip /etc/nginx/nginx.conf` si tienes Docker.
- 🟡 **`knip` a medias.** El script `limpieza` solo mira ficheros (`--include files`), `knip` no está en `verificar`, y `knip.json` apunta al esquema de `knip@5` con `knip 6.40` instalado.
- 🟡 **Un comentario de `index.html:14-15`** dice que el sello "va embebido para que no haya una petición más", pero es un `<link href="/sello.svg">`: una petición más. Y `index.html:22` avisa de que duplica la clave de `shared/lib/tema.ts`: es un acoplamiento que solo protege un comentario.

---

## 4. Ejercicio (40 min)

Rama `ejercicio/dia-12` desde `main`. Objetivo: ver con tus ojos la diferencia entre dev y build, demostrar que `VITE_API_URL` se cocina al construir, y arreglar el 🔴 midiendo antes y después.

### Paso 1 — Rama e instalación (5 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-12 origin/main
cd frontend
node -v                       # 20.19+ o 22.12+
npm ci
npm run typecheck && echo TIPOS_OK
npx vitest run                # esperado: 11 files, 88 passed
```

### Paso 2 — Desarrollo contra el gateway falso (7 min)

**Terminal 1**, el servidor falso en el puerto del gateway de verdad:

```bash
cd frontend
node pruebas-e2e/servidor-falso.mjs 8080
```

**Terminal 2**, Vite:

```bash
cd frontend
cp -n .env.example .env       # VITE_API_URL=http://localhost:8080
npm run dev
```

Abre en el navegador `http://localhost:5173/` (fíjate en a dónde te lleva), `/arquitectura`, pulsa un nodo del diagrama, recarga en `/arquitectura/qdrant` y entra en `/app`. Haz una pregunta en el chat: el servidor falso responde con un texto sobre el teorema CAP.

**Terminal 3**, mira lo que Vite sirve en desarrollo:

```bash
curl -s localhost:5173/src/shared/api/cliente.ts | head -c 400; echo
curl -s localhost:5173/src/main.tsx | head -c 600; echo
```

En la primera verás que Vite ha **inyectado** `import.meta.env = {..., "VITE_API_URL": "http://localhost:8080"}` al principio del módulo. En la segunda, que `@/app/Raiz` se ha reescrito a `/src/app/Raiz.tsx` y que ya no hay JSX. Pega las dos salidas (recortadas) en la entrega.

Deja las terminales 1 y 2 abiertas. Para Vite (Ctrl+C) cuando termines el Paso 2.

### Paso 3 — El valor se cocina al construir (6 min)

```bash
cd frontend
npm run build
grep -o '`/api`' dist/assets/index-*.js            # el valor literal, dentro del JS
node herramientas/comprobar-bundle.mjs             # ✓ nada prohibido

VITE_API_URL=http://localhost:9999 npx vite build > /dev/null
node herramientas/comprobar-bundle.mjs; echo "exit=$?"   # ✗ ... "localhost:9999" ... exit=1

npm run build > /dev/null                          # deja dist/ limpio otra vez
```

En la segunda comprobación verás un fragmento del JS minificado como ``var Jt=`http://localhost:9999`;function Yt(e){return`${Jt}${e}`}``: es tu `urlDe()` después de Rolldown. Pega ambas salidas.

### Paso 4 — Mide lo que descarga la portada (5 min)

El script va **fuera del repo**:

```bash
mkdir -p /tmp/agent4u-front
cat > /tmp/agent4u-front/medir.mjs <<'EOF'
// Suma el JS que el navegador descarga ANTES de pintar: el <script> de entrada
// y los <link rel="modulepreload"> de dist/index.html.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const html = readFileSync('dist/index.html', 'utf8');
const rutas = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
let crudo = 0;
let gz = 0;
for (const r of rutas) {
  const b = readFileSync('dist' + r);
  crudo += b.length;
  gz += gzipSync(b).length;
  console.log(r.padEnd(46), (b.length / 1024).toFixed(1).padStart(7), 'kB');
}
console.log(`TOTAL inicial: ${rutas.length} ficheros · ${(crudo / 1024).toFixed(1)} kB · ${(gz / 1024).toFixed(1)} kB gzip`);
EOF

cd frontend
node /tmp/agent4u-front/medir.mjs
grep -l "Nueva conversación" dist/assets/*.js
```

Esperado (los hashes cambiarán): `TOTAL inicial: 7 ficheros · 449.6 kB · 146.1 kB gzip`, y `Nueva conversación` dentro de `dist/assets/index-*.js`, que es el chunk de entrada. Es decir: el texto del botón del chat viaja a quien solo quiere leer la portada.

### Paso 5 — Haz lazy la aplicación (7 min)

En `src/app/Raiz.tsx`:

1. **Borra** la línea 5: `import { App } from '@/app/App';`
2. **Justo antes** de `const Inicio = lazy(...)` (línea 14), añade:

```tsx
// `App` es un export con nombre y `lazy` exige un `default`: se adapta aquí.
const App = lazy(() => import('@/app/App').then((m) => ({ default: m.App })));
```

3. En el router, cambia `{ path: RUTA_APP, element: <App /> },` por:

```tsx
  { path: RUTA_APP, element: diferida(App) },
```

Comprueba y vuelve a medir:

```bash
npm run typecheck && npx vitest run
npm run lint
npm run build
node herramientas/comprobar-bundle.mjs
node /tmp/agent4u-front/medir.mjs
grep -l "Nueva conversación" dist/assets/*.js
git diff --stat                      # solo src/app/Raiz.tsx
```

Esperado: `TOTAL inicial: 5 ficheros · 363.8 kB · 119.9 kB gzip` y `Nueva conversación` ahora en `dist/assets/App-*.js`. Fíjate en que el chunk de entrada **crece** (de unos 267 a unos 321 kB) aunque el total baje: el router, que antes iba en un chunk compartido aparte, ahora entra en el de entrada porque ya no hay que compartirlo con la App. Por eso se mide **el total inicial** y no un fichero suelto.

Vuelve a arrancar `npm run dev` (con la terminal 1 abierta) y entra en `/app`: tiene que funcionar igual. Con las DevTools (pestaña *Network*, filtro JS) mira cuándo se pide `App.tsx` al navegar de `/home` a `/app`.

### Paso 6 — Commit y push (2 min)

```bash
cd ~/ruta/AGENT4U
git add frontend/src/app/Raiz.tsx
git status --short                   # nada más: ni .env ni dist/ (están en .gitignore)
git commit -m "perf(frontend): cargar /app en diferido para no descargarla en el sitio"
git push -u origin ejercicio/dia-12
```

### Paso 7 — El mapa (8 min, en la entrega)

Dibuja en Mermaid, **sin copiar la píldora**:

1. **El árbol de rutas** de `Raiz.tsx`: qué rutas hay, cuáles cuelgan de `<Sitio />`, cuál es una hija con `element: null`, cuál redirige, cuál es lazy (marca también tu cambio).
2. **El grafo de dependencias entre carpetas** (`app`, `features`, `shared`, `sitio`, `routes.ts`), con flechas en el sentido del `import`. Compruébalo antes con:

```bash
cd frontend
for d in app features shared sitio; do
  echo "== $d importa:"
  grep -rhoE "from '@/[a-z]+" src/$d --include=*.ts --include=*.tsx | sort | uniq -c
done
```

### Preguntas (responde con tus palabras)

1. ¿Por qué `npm run dev` arranca en menos de un segundo y no genera `dist/`? ¿Qué hace exactamente con un `.tsx` cuando el navegador lo pide? Usa la salida del Paso 2. ¿Por qué un error de tipos no impide que la página cargue en dev pero sí rompe `npm run build`?
2. Explica con el Paso 3 por qué `VITE_API_URL` "se cocina". Si mañana quieres desplegar la **misma** imagen en `staging.agent4u.es` y `agent4u.es`, ¿funciona hoy? ¿Por qué sí o por qué no? ¿Qué harías si el gateway viviera en otro dominio?
3. `npm run test:e2e` construye con `localhost:8099` aunque `.env.production` diga `/api`. ¿Qué regla de prioridad lo permite? ¿Qué pasaría si en `verificar` el build final fuera **antes** de las e2e?
4. Describe la regla de dependencias entre `app/`, `features/`, `shared/` y `sitio/` con tu grafo. ¿Qué impide hoy romperla? Propón una forma concreta de hacerla cumplir en CI (herramienta y regla).
5. En `nginx.conf`: ¿qué pasaría al recargar en `/arquitectura/qdrant` sin `try_files`? ¿Y si quitas la barra final de `proxy_pass http://gateway:8080/`? ¿Por qué `/assets/` se cachea un año e `index.html` nunca?
6. Tu cambio del Paso 5: ¿cuánto ahorra quien entra por la portada y cuánto **paga** ahora quien entra directamente en `/app`? `diferida()` pinta `Cargando`, un hueco con forma de cabecera de revista: ¿encaja con la pantalla de `/app`? ¿Qué pondrías?
7. Ejecuta `npx tsc -b --listFiles | grep -v node_modules | grep -v /src/`. ¿Qué ficheros TypeScript del frontend no comprueba nadie? ¿Cómo lo arreglarías en los `tsconfig`?

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-12` creada desde `main` y subida, con un único commit que solo toca `frontend/src/app/Raiz.tsx`.
- [ ] `npm run typecheck`, `npm run lint` y `npx vitest run` (88 passed) en verde con tu cambio.
- [ ] `node herramientas/comprobar-bundle.mjs` en verde con el build final.
- [ ] Salidas del Paso 2 pegadas: `import.meta.env` inyectado y el `import` reescrito.
- [ ] Salidas del Paso 3 pegadas: `/api` dentro del bundle y el fallo con `localhost:9999` (exit=1).
- [ ] Medición antes y después pegada (Pasos 4 y 5), con el chunk donde aparece `Nueva conversación` en cada caso.
- [ ] Los dos diagramas Mermaid del Paso 7.
- [ ] Las 7 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

**Bonus (opcional, si tienes Docker):** `docker compose --profile frontend up --build` con el resto de servicios y comprueba la compresión con `curl -sI -H 'Accept-Encoding: gzip' localhost:3000/assets/<tu-index>.js | grep -i content-encoding`. ¿Sale algo? Añade `gzip on; gzip_types application/javascript text/css image/svg+xml;` al `server` de `nginx.conf` en un segundo commit y repite.

Entrega antes de las **8:30 del viernes 13-nov**:

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-12.md
# ...rellena dia-12.md: salidas, mediciones, diagramas, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-12.md
git commit -m "entrega día 12" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code y te revisa la entrega y la rama al momento.

---

## 5. Para profundizar (opcional)

- Vite, variables de entorno y modos (prioridad de los `.env`, tipado con `ImportMetaEnv`): <https://vite.dev/guide/env-and-mode>
- React Router, `createBrowserRouter`, rutas *layout* y `handle`: <https://reactrouter.com/start/data/routing>

---

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la sección *10. Frontend: herramientas y estructura* debería cubrir:

- Qué hace Vite en dev (módulos sueltos transformados al vuelo, sin comprobar tipos) y en build (`tsc -b` + Rolldown → `dist/` con hash y chunks), y por qué las e2e prueban el build.
- `VITE_API_URL`: los tres caminos (`.env`, `.env.production`, variable de proceso), por qué se cocina al construir, por qué es relativa en producción y qué vigila `comprobar-bundle.mjs`.
- El reparto `app/` · `features/` · `shared/` · `sitio/`, la regla de dependencias y que hoy nadie la hace cumplir.
- Los dos árboles de rutas (`/app` y el sitio bajo `<Sitio />`), `routes.ts` como fuente de verdad y qué se carga en diferido, con tu medición.
- Producción: Dockerfile multietapa, nginx con fallback de SPA, caché por hash y `/api/` → `gateway:8080` sin búfer para el SSE.

**El viernes 13-nov (día 13):** el cliente de API. Seguiremos una pregunta desde que pulsas *Enviar* hasta que se pinta el primer token: `useConversacion`, `preguntar.ts` leyendo el SSE a mano con `fetch` y un `ReadableStream` (no con `EventSource`, y verás por qué), `graphql.ts` y cómo `cliente.ts` convierte cada fallo en un `ErrorApi`, y por qué el `MENSAJES.red` del día 11 no llega cuando el backend cae.
