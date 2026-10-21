# Agent4U · gateway

Gateway GraphQL (Strawberry + FastAPI) entre el frontend y el backend. Es el
único servicio con el que habla el frontend: traduce `POST /graphql` a
llamadas HTTP contra el backend, y reenvía sin tocar el streaming SSE
(`POST /preguntar`) y la subida de ficheros (`POST /indexar-fichero`). Ver el
`README.md` de la raíz del repo para la arquitectura completa de los tres
servicios.

## Arrancar

Necesita el backend arrancado (por defecto en `http://localhost:8000`; lo más
simple es `docker compose up api` desde la raíz del repo, o levantarlo suelto
con `uv run uvicorn app.api.main:app` dentro de `backend/`).

```bash
cp .env.example .env   # opcional: solo si el backend no esta en localhost:8000
uv sync
uv run uvicorn app.main:app --reload --port 8080
```

Playground de GraphQL en `http://127.0.0.1:8080/graphql`.

## Tests

```bash
uv run pytest
```

Los tests usan un `FakeBackendClient` (en `tests/conftest.py`) que implementa
el mismo `Protocol` que `HttpBackendClient`: no hace falta el backend real ni
red para correrlos.

## Estructura

```text
app/
├── main.py          # FastAPI, CORS, montaje del router GraphQL y del proxy REST
├── config.py         # Settings via pydantic-settings, prefijo GATEWAY_
├── clients/
│   ├── port.py       # Protocol BackendClient + BackendHttpError
│   └── http_client.py  # implementacion con httpx
├── schema/
│   ├── types.py      # tipos Strawberry
│   ├── queries.py     # Query: ajustes, documentos, trabajo, conversaciones...
│   └── mutations.py   # Mutation: indexar, eliminar_documento, renombrar_conversacion...
└── proxy.py          # POST /preguntar (SSE) y POST /indexar-fichero (multipart), sin pasar por GraphQL
```
