from graphql import GraphQLError

from app.clients.port import BackendHttpError


def error_backend(e: BackendHttpError) -> GraphQLError:
    """Un error del backend como error GraphQL, con su codigo en extensions.status."""
    return GraphQLError(e.detail or str(e), extensions={"status": e.status})
