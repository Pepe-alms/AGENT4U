import pytest

from app.schema import schema


# ── indexar ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_indexar_exito(fake_client):
    result = await schema.execute(
        'mutation { indexar(file_path: "/docs/nuevo.pdf", type: "pdf") { job_id status } }',
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["indexar"]["job_id"] == "fake-job-1"
    assert result.data["indexar"]["status"] == "en-cola"


@pytest.mark.asyncio
async def test_indexar_conflicto_409(fake_client):
    result = await schema.execute(
        'mutation { indexar(file_path: "/docs/cap.pdf", type: "pdf") { job_id } }',
        context_value={"client": fake_client},
    )

    assert result.data is None
    assert result.errors[0].extensions["status"] == 409


@pytest.mark.asyncio
async def test_indexar_cupo_lleno_429(fake_client):
    fake_client.cupo_lleno = True

    result = await schema.execute(
        'mutation { indexar(file_path: "/docs/otro.pdf", type: "pdf") { job_id } }',
        context_value={"client": fake_client},
    )

    assert result.data is None
    assert result.errors[0].extensions["status"] == 429


# ── indexar_url ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_indexar_url_exito(fake_client):
    result = await schema.execute(
        'mutation { indexar_url(url: "https://ejemplo.com") { job_id status } }',
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["indexar_url"]["job_id"] == "fake-job-2"


@pytest.mark.asyncio
async def test_indexar_url_conflicto_409(fake_client):
    result = await schema.execute(
        'mutation { indexar_url(url: "https://existe.com/ya-indexado") { job_id } }',
        context_value={"client": fake_client},
    )

    assert result.data is None
    assert result.errors[0].extensions["status"] == 409


# ── eliminar_documento ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_eliminar_documento_exito(fake_client):
    result = await schema.execute(
        'mutation { eliminar_documento(nombre: "cap.pdf") { status documento } }',
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["eliminar_documento"]["status"] == "eliminado"


@pytest.mark.asyncio
async def test_eliminar_documento_no_encontrado_404(fake_client):
    result = await schema.execute(
        'mutation { eliminar_documento(nombre: "fantasma.pdf") { status } }',
        context_value={"client": fake_client},
    )

    assert result.data is None
    assert result.errors[0].extensions["status"] == 404


# ── eliminar_conversacion ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_eliminar_conversacion_exito(fake_client):
    result = await schema.execute(
        "mutation { eliminar_conversacion(id: 54321) { status id } }",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["eliminar_conversacion"]["status"] == "eliminada"


@pytest.mark.asyncio
async def test_eliminar_conversacion_no_encontrada_404(fake_client):
    result = await schema.execute(
        "mutation { eliminar_conversacion(id: 99999) { status } }",
        context_value={"client": fake_client},
    )

    assert result.data is None
    assert result.errors[0].extensions["status"] == 404


# ── renombrar_conversacion ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_renombrar_conversacion_exito(fake_client):
    result = await schema.execute(
        'mutation { renombrar_conversacion(id: 54321, titulo: "Nuevo titulo") { titulo } }',
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["renombrar_conversacion"]["titulo"] == "Nuevo titulo"


@pytest.mark.asyncio
async def test_renombrar_conversacion_no_encontrada_404(fake_client):
    result = await schema.execute(
        'mutation { renombrar_conversacion(id: 99999, titulo: "Da igual") { titulo } }',
        context_value={"client": fake_client},
    )

    assert result.data is None
    assert result.errors[0].extensions["status"] == 404
