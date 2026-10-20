import pytest


class FakeBackendClient:
    """Doble del backend para los tests del gateway. Sin red, sin Docker."""

    async def obtener_ajustes(self) -> dict:
        return {
            "modelos": ["gemini/gemini-flash-lite-latest"],
            "max_fragmentos_defecto": 10,
            "max_fragmentos_tope": 20,
            "max_indexaciones_en_vuelo": 5,
        }

    async def close(self) -> None:
        pass


@pytest.fixture
def fake_client():
    return FakeBackendClient()
