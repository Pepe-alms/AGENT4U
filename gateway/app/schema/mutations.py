import strawberry
from strawberry.types import Info

from app.clients.port import BackendHttpError
from app.schema.errores import error_backend
from app.schema.types import (
    AccionResolver,
    ConversacionEliminada,
    ConversacionResumen,
    DocumentoEliminado,
    Resolucion,
    TrabajoEncolado,
)


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
            raise error_backend(e)
        return TrabajoEncolado(**data)

    @strawberry.mutation
    async def indexar_url(
        self, info: Info, url: str, size: int | None = None
    ) -> TrabajoEncolado:
        client = info.context["client"]
        try:
            data = await client.indexar_url(url, size)
        except BackendHttpError as e:
            raise error_backend(e)
        return TrabajoEncolado(**data)

    @strawberry.mutation
    async def eliminar_documento(self, info: Info, id: int) -> DocumentoEliminado:
        """Por id: el nombre no es unico, y borrar por nombre era ambiguo."""
        client = info.context["client"]
        try:
            data = await client.eliminar_documento(id)
        except BackendHttpError as e:
            raise error_backend(e)
        return DocumentoEliminado(**data)

    @strawberry.mutation
    async def resolver_documento(self, info: Info, id: int, accion: AccionResolver) -> Resolucion:
        """Lo que el usuario decide con un documento casi igual a otro
        (estado 'pendiente-decision'). Nunca lo decide el sistema."""
        client = info.context["client"]
        try:
            data = await client.resolver_documento(id, accion.value)
        except BackendHttpError as e:
            raise error_backend(e)
        return Resolucion(**data)

    @strawberry.mutation
    async def eliminar_conversacion(self, info: Info, id: int) -> ConversacionEliminada:
        client = info.context["client"]
        try:
            data = await client.eliminar_conversacion(id)
        except BackendHttpError as e:
            raise error_backend(e)
        return ConversacionEliminada(**data)

    @strawberry.mutation
    async def renombrar_conversacion(
        self, info: Info, id: int, titulo: str
    ) -> ConversacionResumen:
        client = info.context["client"]
        try:
            data = await client.renombrar_conversacion(id, titulo)
        except BackendHttpError as e:
            raise error_backend(e)
        return ConversacionResumen(**data)
