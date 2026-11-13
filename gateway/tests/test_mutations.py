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
        "mutation { eliminar_documento(id: 1) { status id documento } }",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["eliminar_documento"] == {
        "status": "eliminado", "id": 1, "documento": "cap.pdf",
    }


@pytest.mark.asyncio
async def test_eliminar_documento_no_encontrado_404(fake_client):
    result = await schema.execute(
        "mutation { eliminar_documento(id: 99) { status } }",
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


@pytest.mark.asyncio
async def test_indexar_el_mismo_fichero_dice_con_cual_coincide(fake_client):
    """El 409 de 'mismo fichero' lleva en extensions el motivo y el documento."""
    result = await schema.execute(
        'mutation { indexar(file_path: "/docs/copia-de-cap.pdf", type: "pdf") { job_id } }',
        context_value={"client": fake_client},
    )

    extensiones = result.errors[0].extensions
    assert extensiones["status"] == 409
    assert extensiones["motivo"] == "mismo-fichero"
    assert extensiones["duplicado_de"] == {"id": 1, "name": "cap.pdf", "state": "indexado"}


# ── resolver_documento ───────────────────────────────────────────────


def _con_pendiente(fake_client):
    fake_client.documentos.append({
        **fake_client.documentos[0], "id": 2, "origin": "/docs/cap-v2.pdf", "name": "cap-v2.pdf",
        "state": "pendiente-decision", "parecido_a": 1,
        "pct_nuevo_en_antiguo": 0.8, "pct_antiguo_en_nuevo": 0.95,
    })


@pytest.mark.asyncio
@pytest.mark.parametrize("accion, status, reemplazado", [
    ("reemplazar", "en-cola", 1),
    ("conservar", "en-cola", None),
    ("descartar", "descartado", None),
])
async def test_resolver_documento_con_cada_accion(fake_client, accion, status, reemplazado):
    _con_pendiente(fake_client)

    result = await schema.execute(
        f"mutation {{ resolver_documento(id: 2, accion: {accion}) {{ id accion status reemplazado }} }}",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["resolver_documento"] == {
        "id": 2, "accion": accion, "status": status, "reemplazado": reemplazado,
    }


@pytest.mark.asyncio
async def test_resolver_un_documento_no_pendiente_es_409(fake_client):
    result = await schema.execute(
        "mutation { resolver_documento(id: 1, accion: conservar) { status } }",
        context_value={"client": fake_client},
    )

    assert result.errors[0].extensions["status"] == 409


@pytest.mark.asyncio
async def test_resolver_con_una_accion_que_no_existe_no_llega_al_backend(fake_client):
    result = await schema.execute(
        "mutation { resolver_documento(id: 2, accion: fusionar) { status } }",
        context_value={"client": fake_client},
    )

    assert result.errors is not None
