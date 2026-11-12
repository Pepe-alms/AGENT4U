FROM python:3.12-slim

# g++ no es para compilar dependencias (todas llegan en ruedas): Docling compila
# su modelo de layout con torch.compile, y en CPU el backend de Torch necesita
# un compilador de C++ en tiempo de ejecucion. Sin el, convertir un PDF falla
# con InvalidCxxCompiler.
RUN apt-get update && apt-get install -y --no-install-recommends g++ \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
# La cache de uv vive fuera de la imagen: reconstruir tras tocar una dependencia
# solo descarga lo que cambia. Con cache montada, uv no puede enlazar y copia.
ENV UV_LINK_MODE=copy
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

COPY app ./app

ENV PATH="/app/.venv/bin:$PATH"
ENV HF_HOME=/models/hf

CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000"]