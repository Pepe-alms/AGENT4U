from httpx import AsyncClient, ASGITransport
from app.main import app


async def test_health() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://health") as client:
        response = await client.get("/health")

    assert response.status_code == 200
