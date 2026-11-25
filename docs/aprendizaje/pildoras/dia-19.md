# Píldora 19 — CI, linters y Docker multiservicio

**Miércoles 25-nov-2026 · sesión corta: 20 min de lectura + 40 min de ejercicio**

## 0. Crítica de la entrega del día 18

No hay entrega del día 18: en `origin/aprendizaje` no existe `entregas/dia-18.md` ni hay ramas `ejercicio/dia-*` en el remoto. Tampoco ha llegado tarde ninguna anterior. Sin nota.

Hoy tengo que corregir la píldora 17. Allí escribí que el gateway tenía ruff «fijado en `uv.lock` (0.16.9)». **No es así.** `gateway/pyproject.toml` no declara ruff y `grep -c 'name = "ruff"' gateway/uv.lock` da `0`. El 0.16.9 que medí era el ruff global de mi máquina. `uv run` no lo encontró en el `.venv` del gateway y tiró del `PATH`. Ese error es justo el tema de hoy: **una herramienta que no está fijada depende de la máquina que la ejecuta.** En el ejercicio lo vas a arreglar.

`main` sigue en `2cf91a8` (16-nov). Todo lo que viene ahora lo he comprobado hoy contra ese commit:

| Comprobación | Resultado hoy |
|---|---|
| `ruff check app` (backend, 0.15.22 fijado) | `All checks passed!` |
| `ruff check .` (gateway, con 0.15.22) | `All checks passed!` |
| `ruff check .` (gateway, con 0.16.9) | `Found 3 errors.` |
| `ruff format --check` | backend: 67 ficheros sin formatear; gateway: 9 |
| `mypy app` (backend) | `Duplicate module named "conversation"` y para |
| `mypy app` (gateway, con sus dependencias) | `Success: no issues found in 12 source files` |
| `pytest` (gateway) | 66 passed en 1,2 s |
| `npm run typecheck`, `lint`, `format:check`, `knip` | limpios |
| `vitest run` | 14 ficheros, 117 tests |
| `playwright test --project=chrome` con `CI=1` | 42 passed, 1 skipped, 1,0 min |
| `build` + `comprobar:bundle` | `✓ 23 ficheros de 'dist' revisados, nada prohibido.` |

El backend no lo he podido ejecutar entero en mi entorno porque el índice de PyTorch CPU está bloqueado. La cifra de referencia sigue siendo la del día 17: **188 tests**. GitHub Actions confirma que la suite pasa: la ejecución 96 (23-nov) acabó en verde en 55 s.

---

## 1. Concepto clave: el CI es un script que no se fía de tu máquina

### 1.1 Qué es y qué no es

La **integración continua (CI)** consiste en ejecutar en una máquina limpia, en cada cambio, las mismas comprobaciones que deberías ejecutar tú. Hay tres palabras importantes:

- **Limpia.** Parte de cero: sin tu `.venv`, sin tu `node_modules`, sin tu ruff global y sin tu `.env`. Todo lo que funciona «porque en mi máquina está» falla aquí. Es lo que me pasó con ruff en la píldora 17.
- **Misma.** El CI no debe inventar comprobaciones propias. Ejecuta tus scripts (`npm run lint`, `uv run pytest`). Si el CI y tu terminal ejecutan cosas distintas, uno de los dos miente.
- **Cada cambio.** El valor del CI está en que avisa **antes** de mezclar. Una comprobación que solo corre «cuando alguien se acuerda» no es una comprobación.

El CI **no** es el despliegue. Eso es CD (*continuous delivery/deployment*), y AGENT4U no lo tiene.

### 1.2 GitHub Actions en cinco conceptos

```text
workflow (.github/workflows/x.yml)
 └─ on:        cuándo se dispara (push, pull_request, schedule, workflow_dispatch)
 └─ jobs:      trabajos; cada uno en una máquina nueva (runs-on: ubuntu-latest)
     └─ steps: pasos secuenciales en esa máquina
         ├─ uses: una acción reutilizable (actions/checkout@v4, astral-sh/setup-uv@v5)
         └─ run:  un comando de shell
```

- **Los jobs no comparten disco.** Si un job instala dependencias y otro ejecuta los tests, el segundo no las ve. Por eso cada job hace su propio `checkout` y su propio `install`.
- **Caché frente a artefacto.** La caché (`enable-cache`, `cache: npm`) acelera las ejecuciones futuras y se identifica por el hash del lockfile. Un artefacto (`upload-artifact`) guarda ficheros de **esta** ejecución para que tú los descargues, por ejemplo las trazas de Playwright cuando algo falla.
- **`concurrency`.** Si haces dos *push* seguidos, cancela la ejecución anterior del mismo grupo.
- **`paths`.** El workflow solo se dispara si el cambio toca esas rutas.
- **`CI=true`.** Actions la define siempre. Las herramientas la leen: Playwright, por ejemplo, y tu `playwright.config.ts` también.

### 1.3 Linter, formateador y comprobador de tipos

Hacen cosas distintas, y conviene no mezclarlas:

| Tipo | Pregunta | En AGENT4U |
|---|---|---|
| **Linter** | ¿Hay un patrón sospechoso? (import sin usar, `await` olvidado, hook dentro de un `if`) | ruff (Python), oxlint (`src/`), ESLint (solo `pruebas-e2e/`) |
| **Formateador** | ¿El código tiene la forma acordada? No opina de la lógica. | Prettier (frontend). En Python, `ruff format` existe pero **no se usa** |
| **Tipos** | ¿Los tipos encajan sin ejecutar nada? | `tsc -b` (frontend), mypy (backend: roto; gateway: no configurado, aunque pasa) |
| **Código muerto** | ¿Hay ficheros o exportaciones que nadie importa? | knip (frontend) |
| **Comprobación del resultado** | ¿El artefacto que se publica está bien? | `herramientas/comprobar-bundle.mjs` |

La regla para meter algo en el CI: **solo lo que hoy está en verde**. Si metes `mypy` del backend tal como está, el CI estará rojo siempre, la gente se acostumbrará al rojo y dejará de mirarlo. Primero se arregla, después se exige.

---

## 2. Cómo está en AGENT4U

### 2.1 El único workflow: `.github/workflows/backend.yml`

Tiene 39 líneas y llegó en `aa222ec` (#27, 6-sep). No se ha tocado desde entonces:

```yaml
on:
  push:                       # l. 4: CUALQUIER rama, CUALQUIER fichero
  pull_request:
    branches: [main]

concurrency:
  group: backend-${{ github.ref }}
  cancel-in-progress: true

jobs:
  tests:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: backend
    env:
      APP_GEMINI_API_KEY: dummy-para-tests
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
          cache-dependency-glob: backend/uv.lock
      - run: uv sync --frozen
      - run: uv run pytest -q --tb=short
```

(He quitado los `name:` para que quepa.) Línea por línea, lo importante:

- **`APP_GEMINI_API_KEY: dummy-para-tests`**. `Settings` (día 02) exige la clave al arrancar. Los tests no llaman a Gemini porque usan dobles (día 17), pero sin la variable ni siquiera se puede importar la configuración. Una clave falsa en claro es lo correcto: no hace falta un *secret*, porque no vale para nada.
- **`uv sync --frozen`**. Instala **exactamente** lo que dice `uv.lock`. Si `pyproject.toml` y el lock no coinciden, falla en vez de resolver de nuevo. Es lo que quieres en CI: reproducibilidad.
- **`enable-cache` + `cache-dependency-glob`**. Sin la caché, cada ejecución descargaría torch, docling y transformers. Con ella, el job entero tarda menos de un minuto (55 s en la ejecución 96).
- **`timeout-minutes: 20`**. El valor por defecto son 6 horas. Un test colgado (por ejemplo, un `await` sobre Redis que nunca responde) te consumiría minutos de Actions durante horas.

Lo que **no** hace: no ejecuta `ruff`, ni `mypy`, ni nada del gateway ni del frontend. El propio README lo dice en *Deuda técnica conocida*: «solo corre tests, no lint ni tipado; gateway y frontend no tienen workflow».

### 2.2 Los linters, configuración a configuración

**Backend: `backend/pyproject.toml`**

```toml
[tool.ruff]
line-length = 200
```

No hay nada más. Sin `select`, ruff aplica sus reglas por defecto (`E4`, `E7`, `E9`, `F`: errores de sintaxis, nombres sin definir, imports sin usar...). Es un mínimo razonable, pero es solo un mínimo. Si activas `--select E,F,I,B,UP` sobre `app/`, salen **58 hallazgos**: 22 de imports sin ordenar (`I001`), 16 `raise` dentro de `except` sin `from` (`B904`), 9 anotaciones `Optional[X]` en lugar de `X | None` (`UP007`)... Los `B904` son los que de verdad importan: sin `from e` se pierde la causa original en el *traceback*. `line-length = 200` es, en la práctica, desactivar el límite de línea.

`mypy` está en `[dependency-groups] dev`, pero **no hay ninguna sección `[tool.mypy]`**. El README dice «`mypy` configurado y no en verde», y la mitad de esa frase es falsa: no hay configuración. Lo que falla es esto:

```text
app/db/models/conversation.py: error: Duplicate module named "conversation" (also at "app/db/crud/conversation.py")
Found 1 error in 1 file (errors prevented further checking)
```

La causa es que **ningún directorio de `app/` tiene `__init__.py`** (son *namespace packages*). Sin `__init__.py`, mypy no sabe que el primero es `app.db.models.conversation` y el segundo `app.db.crud.conversation`. Para él, los dos se llaman `conversation`. Python sí los distingue al ejecutar, por eso la aplicación funciona. Se arregla con `explicit_package_bases = true` en un `[tool.mypy]`. Con ese flag, mypy ya entra a comprobar tipos y empieza a dar errores de verdad, como los `Item "None" of ... has no attribute "begin"` de `app/db/migrar.py:50`. No te doy el número exacto porque en mi entorno faltaban dependencias del backend y la cifra no sería fiable.

**Gateway: `gateway/pyproject.toml`**

No configura ruff ni mypy, y su grupo `dev` solo tiene `pytest` y `pytest-asyncio`. Aun así, el README lo pone en la tabla como «`ruff check` (backend y gateway): en verde». Lo comprobé con un `PATH` sin ruff global:

```text
$ uv run ruff check .
error: Failed to spawn: `ruff`
  Caused by: No such file or directory (os error 2)
```

En un runner limpio de GitHub falla igual. Y mypy **sí** pasa, siempre que se ejecute dentro del entorno del gateway, que tiene Strawberry instalado: `Success: no issues found in 12 source files`. A diferencia del backend, aquí sí hay `__init__.py`. Es lo más fácil del día: una comprobación en verde que nadie exige.

**Frontend: cinco herramientas, cada una con su terreno**

- `.oxlintrc.json`: plugins `react`, `typescript` y `oxc`, más dos reglas explícitas (`react/rules-of-hooks` como error y `react/only-export-components` como aviso). Se aplica a todo el proyecto.
- `eslint.config.js`: **solo** `pruebas-e2e/**/*.ts`. El comentario de cabecera explica el motivo: oxlint no tiene reglas de Playwright, y «cuatro veces se ha colado una asercion sin espera». Cada regla activada trae su porqué en línea, y cada regla desactivada también. Es la configuración mejor documentada del repo.
- `.prettierrc.json`: `printWidth: 90`, comillas simples y comas finales. `.prettierignore` deja fuera `dist`, `node_modules` y `package-lock.json`.
- `knip.json`: los puntos de entrada son las rutas, las páginas del sitio, las e2e y `herramientas/*.mjs`. El script `npm run limpieza` usa `--include files`, que solo busca **ficheros** huérfanos. `npx knip` sin filtro también mira exportaciones y dependencias, y hoy también está limpio. Lo que no cuadra: el `$schema` apunta a `knip@5` y el instalado es el 6.
- `tsc -b`: compila en modo *build* los dos `tsconfig` referenciados (`app` y `node`), sin emitir nada.

Y el script que lo encadena todo:

```json
"verificar": "npm run typecheck && npm run lint && npm run format:check && npm run test && npm run test:e2e && npm run build && npm run comprobar:bundle"
```

**El orden no es casual**, y `herramientas/comprobar-bundle.mjs` lo explica en su cabecera: `test:e2e` construye con `VITE_API_URL=http://localhost:8099` (el servidor falso) y deja **ese** `dist/`. Por eso el `build` bueno va después, y la revisión del bundle va al final. Si inviertes el orden, `verificar` acaba en verde con un bundle que apunta a localhost. El CI del ejercicio tiene que respetar este orden.

### 2.3 Docker multiservicio, lo que importa para el CI

Las tres imágenes que se construyen:

| Imagen | Base | Detalle de construcción |
|---|---|---|
| `backend/Dockerfile` (api y worker) | `python:3.12-slim` + `g++` | `uv sync --frozen --no-dev` con `--mount=type=cache`; `.dockerignore` deja fuera `.venv`, tests, `*.db` |
| `gateway/Dockerfile` | `python:3.12-slim` | `uv sync --frozen --no-dev` **sin** montaje de caché; **no hay** `.dockerignore` |
| `frontend/Dockerfile` | `node:20-alpine` → `nginx:1.27-alpine` | multietapa: compila y sirve solo `dist/` |

Hay tres decisiones buenas:

1. **Una sola imagen para api y worker.** En `docker-compose.yml`, los dos servicios tienen `build: ./backend`. El worker solo cambia el `command` (`python -m app.worker`). Comparten código y versión de los modelos sin poder desincronizarse.
2. **El ancla `x-backend-env: &backend-env`.** La configuración de api y worker está escrita una sola vez. El comentario lo justifica: si divergen, «se indexa con una y se consulta con otra sin que nada falle».
3. **Copiar primero `pyproject.toml` y `uv.lock`, y después `app/`.** Docker cachea por capas. Si solo cambias código, la capa del `uv sync` (gigas de torch) se reutiliza.

---

## 3. Por qué se montó así (y qué no cuadra)

**Por qué solo backend.** El workflow es de septiembre. Entonces el backend era casi todo el proyecto: el gateway y el worker llegaron el 21-oct (`fb93eea`) y las e2e del frontend después. Nadie volvió a abrir el fichero. No es una decisión, es un olvido, y el README lo reconoce como deuda.

**Por qué un workflow por servicio y no uno con tres jobs.** Lo que te propongo en el ejercicio son tres ficheros (`backend.yml`, `gateway.yml` y `frontend.yml`), y no uno con tres jobs. Tiene una ventaja: cada uno lleva su propio filtro `paths`. Si tocas solo el frontend, no se descargan los gigas del backend. El coste es que la lógica común (checkout, concurrencia) se repite tres veces. Con tres servicios se aguanta; con diez harías un *reusable workflow*.

**Por qué ruff y oxlint y no flake8/pylint y ESLint para todo.** Los dos están escritos en Rust y tardan milisegundos: `npx oxlint` sobre todo el frontend tarda menos de medio segundo. La velocidad importa porque un linter lento se acaba saltando. El coste en el frontend es tener **dos** linters, porque oxlint no tiene plugin de Playwright. La solución de `eslint.config.js`, que acota `files` para que no se pisen, es la correcta.

**Por qué Prettier en el frontend y nada en Python.** Prettier llegó con el frontend nuevo. En Python nunca se adoptó un formateador. Si hoy activas `ruff format --check` en CI, 67 ficheros del backend fallan. Si alguna vez lo adoptas, que sea en **un commit aparte, solo de formato**, para que `git blame` no se llene de ruido. Por eso no lo meto en el ejercicio.

### Cosas que no cuadran, comprobadas hoy

- 🔴 **El CI del backend corre con cualquier push, sea del fichero que sea.** Cada píldora que subo a `aprendizaje` (solo Markdown) dispara la suite completa del backend: son las ejecuciones 92 a 96 de Actions. Además, `push` sin filtro más `pull_request` hacen que una rama con PR abierta se ejecute **dos veces** por commit: las ejecuciones 89 y 90 son el mismo `9488594` de `feat/deduplicacion`. `concurrency` no lo evita, porque `github.ref` vale `refs/heads/feat/...` en un caso y `refs/pull/N/merge` en el otro, así que son dos grupos distintos.
- 🟠 **El gateway dice «ruff en verde» sin tener ruff.** Lo has visto en 2.2. La consecuencia práctica es que cada máquina usa su propia versión: con 0.15.22 está limpio y con 0.16.9 da 3 errores.
- 🟠 **`mypy` del backend: «configurado» no es verdad.** No hay `[tool.mypy]`. Además, `backend/README.md:41` dice `uv run mypy .`, que también mira `tests/` y choca con el mismo error.
- 🟠 **Las cifras del README siguen viejas** (91/45/88 tests contra los 188/66/117 reales). Es un buen argumento para que el CI sea la fuente de verdad, y no una tabla escrita a mano.
- 🟠 **`node:20-alpine` en `frontend/Dockerfile`.** Node 20 dejó de tener soporte en abril de 2026. Vite 8 exige `^20.19` o `>=22.12` (ESLint 10, `^20.19`, `^22.13` o `>=24`), así que hoy funciona por poco. Además, el repo no tiene `.nvmrc` ni `engines` en `package.json`: nada dice qué Node es el oficial. En el CI del ejercicio uso Node 22.
- 🟡 **Imágenes sin fijar.** `ghcr.io/astral-sh/uv:latest` en los dos Dockerfile de Python y `redis:7-alpine` (flotante) en compose, mientras que Qdrant sí está fijado (`v1.19.0`). Un `latest` es justo el «en mi máquina funcionaba» del 1.1, solo que en Docker.
- 🟡 **El gateway no tiene `.dockerignore`.** El `Dockerfile` copia solo `pyproject.toml`, `uv.lock` y `app/`, así que la imagen sale bien. Pero el *contexto* que se envía al demonio de Docker incluye tu `.venv` local.
- 🟡 **`playwright.config.ts` no tiene `forbidOnly`.** Si se cuela un `test.only`, el CI ejecutaría un solo test y saldría en verde. Vitest sí lo impide por defecto cuando `CI=true`. La config ya está preparada para CI en otros dos sitios (`retries: process.env.CI ? 1 : 0` y `reuseExistingServer: !process.env.CI`), pero nunca se ha ejecutado en un CI.
- 🟡 **El workflow no declara `permissions:`.** Hereda los permisos por defecto del repositorio para `GITHUB_TOKEN`. Para ejecutar tests basta con `contents: read`.

---

## 4. Ejercicio (≈40 min)

Objetivo: que `main` deje de poder recibir un gateway o un frontend roto sin que nadie se entere. Vas a crear `gateway.yml` y `frontend.yml`, fijar las herramientas del gateway, comprobarlo todo en local, verlo en verde en Actions y romperlo una vez a propósito.

He probado los pasos 2 a 5 en una copia limpia de `2cf91a8`. Los dos YAML pasan `actionlint` sin avisos.

### Paso 0 — Rama (2 min)

```bash
cd ~/ruta/a/AGENT4U
git fetch origin
git switch -c ejercicio/dia-19 origin/main
```

### Paso 1 — Fijar ruff y mypy en el gateway (5 min)

```bash
cd gateway
uv add --dev ruff==0.15.22 mypy==2.3.0      # las mismas versiones que backend/uv.lock
git diff --stat                              # pyproject.toml y uv.lock, nada más
uv run ruff --version                        # ruff 0.15.22, ahora desde gateway/.venv
uv run ruff check .                          # All checks passed!
uv run mypy app                              # Success: no issues found in 12 source files
uv run pytest -q                             # 66 passed
cd ..
```

Comprueba que el ruff es el del proyecto: `uv run which ruff` tiene que apuntar a `gateway/.venv/bin/ruff`.

### Paso 2 — `.github/workflows/gateway.yml` (5 min)

```bash
cat > .github/workflows/gateway.yml <<'EOF'
name: Gateway

on:
  push:
    paths:
      - 'gateway/**'
      - '.github/workflows/gateway.yml'
  pull_request:
    branches: [main]
    paths:
      - 'gateway/**'
      - '.github/workflows/gateway.yml'

concurrency:
  group: gateway-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  calidad:
    name: Lint y tests
    runs-on: ubuntu-latest
    timeout-minutes: 10

    defaults:
      run:
        working-directory: gateway

    steps:
      - name: Descargar el repositorio
        uses: actions/checkout@v4

      - name: Instalar uv
        uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
          cache-dependency-glob: gateway/uv.lock

      - name: Instalar dependencias
        run: uv sync --frozen

      - name: Lint (ruff, versión fijada en uv.lock)
        run: uv run ruff check .

      - name: Tipos (mypy)
        run: uv run mypy app

      - name: Tests
        run: uv run pytest -q --tb=short
EOF
```

Fíjate en que `paths` incluye el propio YAML. Si no, al editar el workflow no se ejecutaría y no sabrías si lo has roto.

### Paso 3 — `.github/workflows/frontend.yml` (8 min)

```bash
cat > .github/workflows/frontend.yml <<'EOF'
name: Frontend

on:
  push:
    paths:
      - 'frontend/**'
      - '.github/workflows/frontend.yml'
  pull_request:
    branches: [main]
    paths:
      - 'frontend/**'
      - '.github/workflows/frontend.yml'

concurrency:
  group: frontend-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  calidad:
    name: Tipos, lint, unidad, e2e y bundle
    runs-on: ubuntu-latest
    timeout-minutes: 20

    defaults:
      run:
        working-directory: frontend

    steps:
      - name: Descargar el repositorio
        uses: actions/checkout@v4

      - name: Instalar Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Instalar dependencias
        run: npm ci

      - name: Tipos
        run: npm run typecheck

      - name: Lint (oxlint + eslint)
        run: npm run lint

      - name: Formato
        run: npm run format:check

      - name: Ficheros y exportaciones sin usar (knip)
        run: npx knip

      - name: Tests unitarios (vitest)
        run: npm test

      - name: Comprobar que Chrome está instalado
        run: google-chrome --version

      - name: Tests e2e (Playwright, proyecto chrome)
        run: npx playwright test --project=chrome

      # DESPUÉS de las e2e: dejan en dist/ un build que apunta a localhost.
      - name: Build de producción
        run: npm run build

      - name: Revisar el bundle
        run: npm run comprobar:bundle

      - name: Guardar las trazas si fallan las e2e
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-trazas
          path: frontend/test-results/
          retention-days: 7
EOF
```

Tres decisiones que tienes que entender, no solo copiar:

- **Solo el proyecto `chrome`.** `playwright.config.ts` usa `channel: 'chrome'`, es decir, el Google Chrome instalado y no el Chromium de Playwright. Los runners `ubuntu-latest` lo traen de serie, y el paso `google-chrome --version` lo deja demostrado en el log. WebKit (`iphone`) exige `npx playwright install --with-deps webkit`: descarga unos cientos de MB y suma minutos. Queda como bonus.
- **El orden e2e → build → comprobar.** Es el de `verificar`, por la razón de la sección 2.2.
- **`if: failure()` en las trazas.** `trace: 'retain-on-failure'` ya deja las trazas en `test-results/`. Sin subirlas, un fallo en CI no se puede depurar. Con ellas, descargas el zip y lo abres con `npx playwright show-trace`.

### Paso 4 — Ejecuta en local lo mismo que hará el CI (10 min)

Si no pasa en tu máquina, no pierdas tiempo empujando. Copia el orden exacto del YAML:

```bash
cd frontend
npm ci
npm run typecheck && npm run lint && npm run format:check && npx knip && npm test
CI=1 npx playwright test --project=chrome      # 42 passed, 1 skipped
npm run build && npm run comprobar:bundle      # ✓ 23 ficheros de 'dist' revisados, nada prohibido.
cd ..
```

`CI=1` activa en local el mismo comportamiento que tendrá en Actions: un reintento y servidores levantados de cero. Si tienes algo escuchando en el 5178 o el 8099, ciérralo antes.

Opcional, pero muy recomendable: valida los YAML con `actionlint` (encuentra expresiones `${{ }}` mal escritas, claves inexistentes y acciones con versiones viejas):

```bash
uvx --from actionlint-py actionlint      # sin salida = sin problemas
```

### Paso 5 — Push y verlo en verde (5 min)

```bash
git add gateway/pyproject.toml gateway/uv.lock .github/workflows/gateway.yml .github/workflows/frontend.yml
git status --short                       # exactamente esos 4 ficheros
git commit -m "ci: workflows de gateway y frontend; ruff y mypy fijados en el gateway"
git push -u origin ejercicio/dia-19
```

Abre <https://github.com/Pepe-alms/AGENT4U/actions>. Tienen que aparecer **tres** ejecuciones para ese commit: Backend (que no tiene `paths`), Gateway y Frontend. Espera a que las tres estén en verde y apunta la duración de cada una.

### Paso 6 — Romperlo a propósito (5 min)

```bash
sed -i '1i import os' gateway/app/main.py
uv run --directory gateway ruff check .  # F401 `os` imported but unused
git commit -am "ci: rotura a propósito (se revierte)"
git push
```

En Actions, **Gateway** se pone en rojo en el paso *Lint* y **Frontend no se ejecuta**: el filtro `paths` funciona. Copia en la entrega la línea del error tal como sale en el log. Después:

```bash
git revert --no-edit HEAD
git push
```

### Bonus (opcional, 15 min)

1. Añade a `backend.yml` el mismo bloque `paths` (`backend/**` y el propio YAML). Después sube un cambio que solo toque un `.md` de la raíz y comprueba que ya no se ejecuta el backend.
2. Añade a `playwright.config.ts` la línea `forbidOnly: !!process.env.CI,` y comprueba que un `test.only` hace fallar `CI=1 npx playwright test --project=chrome`.
3. Añade un job `iphone` que ejecute `npx playwright install --with-deps webkit` y `npx playwright test --project=iphone`. Mide cuánto suma.

### Preguntas (respóndelas con tus palabras en la entrega)

1. Antes del Paso 1, ¿qué ruff ejecutaba `uv run ruff` en el gateway en tu máquina? (`uv run which ruff` antes de `uv add`, o razónalo). ¿Por qué en un runner limpio falla, y por qué fijar la versión en el lock es mejor que `uvx ruff`?
2. ¿Por qué las e2e van **antes** del build final? Describe exactamente qué publicarías si inviertes el orden y por qué ninguna otra comprobación lo detectaría.
3. Con `push` sin `branches` y `pull_request: branches: [main]`, ¿cuántas veces se ejecuta Gateway por cada commit en una rama con PR abierta? ¿Por qué `concurrency` no lo evita? Propón una configuración de `on:` que lo evite sin dejar de ejecutar en tus ramas.
4. ¿Por qué no has metido `mypy` del backend ni `ruff format --check` en el CI? ¿Qué pasos harían falta, y en qué orden, para poder meterlos?
5. `APP_GEMINI_API_KEY: dummy-para-tests` va en claro en el YAML. ¿Por qué es correcto aquí? ¿Cuándo tendría que ser un `secrets.X`, y qué cambiaría en las ejecuciones que vienen de *forks*?
6. ¿Qué gana el proyecto con un `.nvmrc` (o `engines` en `package.json`)? ¿Qué tres sitios del repo tendrían que leer o respetar esa versión?

### Criterios de aceptación

- [ ] Existe `ejercicio/dia-19` en el remoto, creada desde `main`, con `gateway.yml`, `frontend.yml`, `gateway/pyproject.toml` y `gateway/uv.lock`, más los dos commits del Paso 6 (rotura y `revert`).
- [ ] `grep -A6 '^\[dependency-groups\]' gateway/pyproject.toml` muestra `ruff==0.15.22` y `mypy==2.3.0`.
- [ ] En Actions, el commit del Paso 5 tiene **Backend, Gateway y Frontend en verde**, y el `revert` del Paso 6 tiene Backend y Gateway en verde. Pon los enlaces en la entrega.
- [ ] El commit de rotura tiene **Gateway en rojo** en el paso *Lint* y **no** tiene ejecución de Frontend. Pega en la entrega el enlace y la línea del error.
- [ ] La entrega incluye la duración de cada workflow en verde.
- [ ] Las 6 preguntas están respondidas con tus palabras.
- [ ] El párrafo para `ARCHITECTURE.md` está en la entrega.

### Entrega: antes de las 8:30 del viernes 27-nov

```bash
git fetch origin && git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-19.md
# ...rellénala...
git add docs/aprendizaje/entregas/dia-19.md
git commit -m "entrega día 19" && git push
```

Si quieres feedback antes, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code (con `XX` = `19`) estando en tu rama `ejercicio/dia-19`.

Nota: esta rama sí merece llegar a `main`. Si te convence, abre una PR `ejercicio/dia-19 → main`. Será la primera PR del repo con los tres workflows ejecutándose a la vez.

---

## 5. Para profundizar (opcional)

- GitHub Docs, *Workflow syntax for GitHub Actions* (`on.<push|pull_request>.paths`, `concurrency`, `permissions`): <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>
- Playwright, *Continuous Integration* (GitHub Actions, trazas y `forbidOnly`): <https://playwright.dev/docs/ci>

---

## 6. Aportación a `ARCHITECTURE.md`

Hoy abres la sección *13. Calidad, CI y contenedores*. Tu párrafo debería cubrir:

- Qué comprueba cada herramienta y dónde: ruff y pytest (backend y gateway), mypy (gateway en verde, backend pendiente por los *namespace packages*), oxlint + ESLint acotado a e2e, Prettier, `tsc -b`, knip y `comprobar-bundle.mjs`.
- La regla de que el CI ejecuta los mismos scripts que tú, con versiones fijadas en los lockfiles, y solo lo que hoy está en verde.
- Un workflow por servicio con filtro `paths`, y el orden e2e → build → comprobar en el frontend.
- Docker: una imagen para api y worker, el ancla `x-backend-env`, el orden de las capas para cachear dependencias, y lo que falta por fijar (`uv:latest`, `redis:7-alpine`, Node 20).

**El viernes 27-nov (día 20):** el arnés de evaluación del RAG. Leeremos `backend/tests/evaluation/`: los dos scripts de indexación, los sets de preguntas y las respuestas guardadas. Veremos también lo que el README admite: el arnés que puntuaba las 25 preguntas ya no está en el repo. El ejercicio será ejecutar un subconjunto contra tu Qdrant local e interpretar los resultados, y decidir qué métrica mínima debería existir para que un cambio en el *retrieval* no empeore las respuestas sin que nadie lo note.
