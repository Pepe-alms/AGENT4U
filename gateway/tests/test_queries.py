import pytest

from app.schema import schema


@pytest.mark.asyncio
async def test_ajustes_devuelve_modelos_y_limites(fake_client):
    result = await schema.execute(
        "{ ajustes { modelos max_fragmentos_defecto max_fragmentos_tope max_indexaciones_en_vuelo } }",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    datos = result.data["ajustes"]
    assert datos["modelos"] == ["gemini/gemini-flash-lite-latest"]
    assert datos["max_fragmentos_defecto"] == 10
    assert datos["max_fragmentos_tope"] == 20
    assert datos["max_indexaciones_en_vuelo"] == 5


@pytest.mark.asyncio
async def test_ajustes_permite_pedir_solo_algunos_campos(fake_client):
    result = await schema.execute(
        "{ ajustes { modelos } }",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert "modelos" in result.data["ajustes"]
    assert "max_fragmentos_defecto" not in result.data["ajustes"]


# ── documentos ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_documentos_devuelve_la_lista(fake_client):
    result = await schema.execute(
        "{ documentos { name state num_chunks } }",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    docs = result.data["documentos"]
    assert len(docs) == 1
    assert docs[0]["name"] == "cap.pdf"
    assert docs[0]["state"] == "indexado"


@pytest.mark.asyncio
async def test_documentos_lista_vacia(fake_client):
    fake_client.documentos.clear()

    result = await schema.execute(
        "{ documentos { name } }",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["documentos"] == []


# ── trabajo ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_trabajo_encontrado(fake_client):
    result = await schema.execute(
        '{ trabajo(job_id: "abc-123") { job_id status name } }',
        context_value={"client": fake_client},
    )

    assert result.errors is None
    trabajo = result.data["trabajo"]
    assert trabajo["job_id"] == "abc-123"
    assert trabajo["status"] == "indexado"


@pytest.mark.asyncio
async def test_trabajo_no_encontrado_devuelve_null(fake_client):
    result = await schema.execute(
        '{ trabajo(job_id: "no-existe") { job_id } }',
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["trabajo"] is None


# ── conversaciones ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_conversaciones_devuelve_la_lista(fake_client):
    result = await schema.execute(
        "{ conversaciones { id titulo } }",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    convs = result.data["conversaciones"]
    assert len(convs) == 1
    assert convs[0]["titulo"] == "Teorema CAP"


# ── conversacion ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_conversacion_encontrada_con_mensajes(fake_client):
    result = await schema.execute(
        "{ conversacion(id: 54321) { id titulo mensajes { id } } }",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    conv = result.data["conversacion"]
    assert conv["id"] == 54321
    assert conv["mensajes"] == []


@pytest.mark.asyncio
async def test_conversacion_no_encontrada_devuelve_null(fake_client):
    result = await schema.execute(
        "{ conversacion(id: 99999) { id } }",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    assert result.data["conversacion"] is None


# ── salud ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_salud_combina_backend_y_qdrant(fake_client):
    result = await schema.execute(
        "{ salud { backend qdrant { status coleccion existe } } }",
        context_value={"client": fake_client},
    )

    assert result.errors is None
    salud = result.data["salud"]
    assert salud["backend"] == "ok"
    assert salud["qdrant"]["status"] == "ok"
    assert salud["qdrant"]["coleccion"] == "Agent4U"
