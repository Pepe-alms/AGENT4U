import strawberry
from graphql import GraphQLError
from strawberry.types import Info

from app.clients.port import BackendHttpError
from app.schema.types import (
    ConversacionEliminada,
    ConversacionResumen,
    DocumentoEliminado,
    TrabajoEncolado,
)


def _error_backend(e: BackendHttpError) -> GraphQLError:
    return GraphQLError(e.detail or str(e), extensions={"status": e.status})


@strawberry.type
class Mutation:
    @strawberry.mutation
    async def indexar(
        self, info: Info, file_path: str, type: str, size: int | None = None
    ) -> TrabajoEncolado:
        client = info.context["client"]
        try:
            data = await client.indexar(file_path, type, size)
        except BackendHttpError as e:
            raise _error_backend(e)
        return TrabajoEncolado(**data)

    @strawberry.mutation
    async def indexar_url(
        self, info: Info, url: str, size: int | None = None
    ) -> TrabajoEncolado:
        client = info.context["client"]
        try:
            data = await client.indexar_url(url, size)
        except BackendHttpError as e:
            raise _error_backend(e)
        return TrabajoEncolado(**data)

    @strawberry.mutation
    async def eliminar_documento(self, info: Info, nombre: str) -> DocumentoEliminado:
        client = info.context["client"]
        try:
            data = await client.eliminar_documento(nombre)
        except BackendHttpError as e:
            raise _error_backend(e)
        return DocumentoEliminado(**data)

    @strawberry.mutation
    async def eliminar_conversacion(self, info: Info, id: int) -> ConversacionEliminada:
        client = info.context["client"]
        try:
            data = await client.eliminar_conversacion(id)
        except BackendHttpError as e:
            raise _error_backend(e)
        return ConversacionEliminada(**data)

    @strawberry.mutation
    async def renombrar_conversacion(
        self, info: Info, id: int, titulo: str
    ) -> ConversacionResumen:
        client = info.context["client"]
        try:
            data = await client.renombrar_conversacion(id, titulo)
        except BackendHttpError as e:
            raise _error_backend(e)
        return ConversacionResumen(**data)
