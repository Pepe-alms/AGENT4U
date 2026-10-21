# Agent4U · backend

API RAG de Agent4U: ingesta de documentos (PDF/DOCX/URL), cola de indexacion
respaldada por Redis + ARQ, y respuesta a preguntas con citas via streaming
SSE. Ver el `README.md` de la raiz del repo para la arquitectura completa de
los tres servicios (frontend, gateway, backend).

## Arrancar

Necesita Qdrant y Redis en marcha (lo mas simple: `docker compose up qdrant
redis` desde la raiz del repo).

```bash
cp .env.example .env   # y rellena APP_GEMINI_API_KEY
uv sync
uv run uvicorn app.api.main:app --reload
```

El worker de indexacion es un proceso aparte:

```bash
uv run python -m app.worker
```

Documentación interactiva (Swagger UI) en `http://127.0.0.1:8000/docs`.

## Tests

```bash
uv run pytest
```

`tests/README.md` explica qué cubre cada carpeta (`unit/`, `integration/`,
`api/`) y qué hay en `tests/evaluation/` (material manual, no lo recoge
pytest).

## Lint y tipos

```bash
uv run ruff check .
uv run mypy .
```
