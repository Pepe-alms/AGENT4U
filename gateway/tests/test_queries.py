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
