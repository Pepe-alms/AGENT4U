from graphql import GraphQLError

from app.clients.port import BackendHttpError


def error_backend(e: BackendHttpError) -> GraphQLError:
    """Un error del backend como error GraphQL, con su codigo en
    extensions.status y el resto de su cuerpo (como 'motivo' y 'duplicado_de'
    del 409 de "mismo fichero") tambien en extensions."""
    return GraphQLError(e.detail or str(e), extensions={**e.extra, "status": e.status})
