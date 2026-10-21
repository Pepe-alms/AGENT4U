import strawberry
from strawberry.types import Info

from app.schema.types import (
    Ajustes,
    ConversacionDetalle,
    ConversacionResumen,
    Documento,
    Fuente,
    Mensaje,
    Salud,
    SaludQdrant,
    Trabajo,
)


def _mensaje_desde_dict(m: dict) -> Mensaje:
    fuentes = m["fuentes"]
    return Mensaje(
        id=m["id"],
        rol=m["rol"],
        contenido=m["contenido"],
        fuentes=[Fuente(**f) for f in fuentes] if fuentes is not None else None,
        creado_en=m["creado_en"],
    )


@strawberry.type
class Query:
    @strawberry.field
    async def ajustes(self, info: Info) -> Ajustes:
        client = info.context["client"]
        data = await client.obtener_ajustes()
        return Ajustes(**data)

    @strawberry.field
    async def documentos(self, info: Info) -> list[Documento]:
        client = info.context["client"]
        data = await client.obtener_documentos()
        return [Documento(**d) for d in data]

    @strawberry.field
    async def trabajo(self, info: Info, job_id: str) -> Trabajo | None:
        client = info.context["client"]
        data = await client.obtener_trabajo(job_id)
        if data is None:
            return None
        return Trabajo(**data)

    @strawberry.field
    async def conversaciones(self, info: Info) -> list[ConversacionResumen]:
        client = info.context["client"]
        data = await client.obtener_conversaciones()
        return [ConversacionResumen(**c) for c in data]

    @strawberry.field
    async def conversacion(self, info: Info, id: int) -> ConversacionDetalle | None:
        client = info.context["client"]
        data = await client.obtener_conversacion(id)
        if data is None:
            return None
        return ConversacionDetalle(
            id=data["id"],
            titulo=data["titulo"],
            creada_en=data["creada_en"],
            actualizada_en=data["actualizada_en"],
            mensajes=[_mensaje_desde_dict(m) for m in data["mensajes"]],
        )

    @strawberry.field
    async def salud(self, info: Info) -> Salud:
        client = info.context["client"]
        backend_data = await client.salud()
        qdrant_data = await client.salud_qdrant()
        return Salud(backend=backend_data["status"], qdrant=SaludQdrant(**qdrant_data))
