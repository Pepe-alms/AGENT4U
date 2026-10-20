import strawberry
from strawberry.schema.config import StrawberryConfig

from app.schema.queries import Query

schema = strawberry.Schema(
    query=Query,
    config=StrawberryConfig(auto_camel_case=False),
)
