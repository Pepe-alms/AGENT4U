import strawberry
from strawberry.schema.config import StrawberryConfig

from app.schema.mutations import Mutation
from app.schema.queries import Query

schema = strawberry.Schema(
    query=Query,
    mutation=Mutation,
    config=StrawberryConfig(auto_camel_case=False),
)
