import strawberry
from strawberry.types import Info

from app.schema.types import Ajustes


@strawberry.type
class Query:
    @strawberry.field
    async def ajustes(self, info: Info) -> Ajustes:
        client = info.context["client"]
        data = await client.obtener_ajustes()
        return Ajustes(**data)
