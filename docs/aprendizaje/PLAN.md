# Plan de aprendizaje AGENT4U — 22 sesiones

Objetivo: recuperar el control del repositorio. Al terminar tienes que poder explicar
**qué hace cada pieza, cómo está montada y por qué se montó así**, y añadir
funcionalidad propia sin depender del agente.

- **Inicio:** miércoles 21-oct-2026 · **Fin:** miércoles 11-nov-2026
- **Entre semana:** ~1 h (20 min de píldora + 40 min de ejercicio)
- **Fines de semana (L):** 2-3 h, con ejercicios más largos y píldoras más extensas
- **Correo diario:** 8:30 (hora de Madrid). La píldora también queda en `pildoras/dia-XX.md`.
- **Tus entregas:** `entregas/dia-XX.md`. Cada píldora empieza con una crítica de la entrega anterior.

> El análisis se hace siempre sobre el código de `main` tal como esté ese día, sin distinguir quién escribió cada parte.
> Si la arquitectura cambia, la píldora del día se adapta al código real.

## Fuentes del "por qué"

- El propio código y sus comentarios. Muchas decisiones están justificadas en línea, por ejemplo en `config.py` y `cola_port.py`.
- `README.md` raíz (*Arquitectura*, *Decisiones de diseño*, *Deuda técnica conocida*), `backend/README.md`, `backend/tests/README.md` y `gateway/README.md`.
- El `git log` de cada área, para ver cómo y cuándo llegó cada pieza a su forma actual.
- Cuando el repo no lo explique, el razonamiento de ingeniería: qué problema resuelve la decisión, qué alternativas había y qué coste tiene.

Esta formación sustituye a la documentación de proceso que se retiró del repo. El conocimiento queda en `ARCHITECTURE.md`, y sobre todo en ti.

---

## Semana 1 — Backend: API, configuración e ingesta asíncrona

| Día | Fecha | Tema | Ficheros foco | Ejercicio (resumen) |
|---|---|---|---|---|
| 01 | Mié 21-oct | Mapa global: los 6 servicios, el arranque y `lifespan` | `docker-compose.yml`, `backend/Dockerfile`, `app/api/main.py`, `app/api/lifespan.py`, `routers/health.py` | Levantar Qdrant, Redis y la API, probar las sondas y medir lo que carga el arranque |
| 02 | Jue 22-oct | Configuración tipada en los tres servicios | `backend/app/core/config.py`, `gateway/app/config.py`, los `.env.example`, `docker-compose.yml` | Seguir el recorrido de una variable desde `.env` hasta el código en backend, gateway y frontend, y añadir una variable nueva |
| 03 | Vie 23-oct | Contratos de la API con Pydantic | `app/api/schemas.py`, `core/exceptions.py` | Predecir el JSON de 3 endpoints antes de llamarlos |
| 04 (L) | Sáb 24-oct | Routers de FastAPI, `Depends` y `app.state` | `app/api/routers/*` | Crear un endpoint `GET /stats` propio, con su esquema |
| 05 (L) | Dom 25-oct | Ingesta asíncrona: API → cola → Redis/ARQ → worker | `routers/indexation.py`, `routers/jobs.py`, `services/cola_port.py`, `services/cola_arq.py`, `worker/*` | Encolar un documento, seguir el trabajo con `/trabajos/{id}` y forzar un 429 |
| 06 | Lun 26-oct | Ingesta en detalle: Docling → chunking → embeddings → Qdrant | `services/indexation_service.py`, `rag/vectorization.py`, `worker/jobs.py` | Inspeccionar en el dashboard de Qdrant los puntos que genera un documento |
| 07 | Mar 27-oct | Recuperación híbrida (dense + BM25 + RRF) y reranking | `rag/retrieval.py` | Comparar resultados con distintos `max_fragmentos` |

## Semana 2 — Consulta, persistencia, gateway y frontend

| Día | Fecha | Tema | Ficheros foco | Ejercicio (resumen) |
|---|---|---|---|---|
| 08 | Mié 28-oct | El grafo agéntico de LangGraph | `rag/grafo/grafo_create.py`, `rag/grafo/grafo_nodes.py` | Dibujar el grafo y registrar en el log el paso por cada nodo |
| 09 | Jue 29-oct | Prompt, LiteLLM y streaming SSE | `rag/prompt.py`, `rag/generation.py`, `rag/streaming.py`, `routers/query.py` | Llamar con `curl -N` a `/preguntar` e identificar cada tipo de evento SSE |
| 10 | Vie 30-oct | Persistencia con SQLAlchemy | `db/session.py`, `db/models/*`, `db/crud/*` | Relacionar las tablas de SQLite con lo que ves en la UI |
| 11 (L) | Sáb 31-oct | El gateway GraphQL (Strawberry): por qué un BFF | `gateway/app/*` | Exponer tu `/stats` como query GraphQL, con su test |
| 12 (L) | Dom 1-nov | Herramientas y estructura del frontend | `vite.config.ts`, `tsconfig*.json`, `src/main.tsx`, `src/routes.ts`, `src/app/*`, `Dockerfile`, `despliegue/nginx.conf`, `knip.json` | Arrancar el frontend y dibujar el mapa de rutas y de carpetas |
| 13 | Lun 2-nov | Cliente de API: GraphQL, SSE y errores | `shared/api/*`, `features/chat/useConversacion.ts` | Seguir una pregunta desde que pulsas *Enviar* hasta que se pinta el primer token |
| 14 | Mar 3-nov | Markdown seguro: marked + DOMPurify | `shared/lib/markdown.ts` | Intentar un XSS y comprobar que se bloquea |
| 15 | Mié 4-nov | Documentos (subida y sondeo) y conversaciones en la UI | `features/documentos/*`, `features/conversaciones/*` | Mostrar en la UI un dato nuevo del trabajo de indexación |

## Semana 3 — Calidad, operación y tomar el mando

| Día | Fecha | Tema | Ficheros foco | Ejercicio (resumen) |
|---|---|---|---|---|
| 16 | Jue 5-nov | Shell, sistema de UI y paleta de comandos | `app/AppShell.tsx`, `shared/ui/*`, `features/comandos/*` | Añadir un comando nuevo a la paleta |
| 17 | Vie 6-nov | Tests del backend y del gateway: niveles y dobles | `backend/tests/*`, `gateway/tests/*` | Escribir el test de tu endpoint `/stats` |
| 18 (L) | Sáb 7-nov | Tests del frontend: Vitest, Testing Library, Playwright y axe | `src/**/*.test.*`, `pruebas-e2e/*`, `playwright.config.ts` | Escribir un test unitario y uno e2e |
| 19 (L) | Dom 8-nov | CI, linters y Docker multiservicio | `.github/workflows/backend.yml`, scripts de `package.json`, ruff/mypy/oxlint/eslint/prettier/knip | Añadir al CI los jobs del gateway y del frontend (hoy no existen) |
| 20 | Lun 9-nov | Arnés de evaluación del RAG | `backend/tests/evaluation/*` | Ejecutar un subconjunto e interpretar las métricas |
| 21 | Mar 10-nov | Sitio editorial y deuda técnica global | `src/sitio/*`, todo el repo | Hacer un inventario priorizado de deuda técnica y zonas peligrosas |
| 22 | Mié 11-nov | Tomar el mando | — | Escribir el ADR de tu primera funcionalidad propia y cerrar `ARCHITECTURE.md` |

---

## Formato de cada píldora

1. **Crítica** de la entrega anterior: qué está bien, qué falta y qué es incorrecto.
2. **Concepto clave**, explicado desde cero cuando haga falta.
3. **Cómo está en AGENT4U**, con ficheros y líneas reales del código actual.
4. **Por qué se montó así**, con la decisión, las alternativas y su coste.
5. **Ejercicio**, con pasos y criterios de aceptación comprobables.
6. **Para profundizar**, con 1-2 enlaces opcionales.
7. **Aportación a `ARCHITECTURE.md`**: el párrafo que deja la sesión.
