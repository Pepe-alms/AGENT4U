
from pydantic import BaseModel

## validamos que el contenido de la consolta como minimo tenga un campo query de tipo string
class QueryRequest(BaseModel):
    query: str
    conversacion_id: str | None = None

class IndexRequest(BaseModel):
    file_path: str
    name: str
    type: str
    size: int | None = None

class IndexUrlRequest(BaseModel):
    url: str
    size: int | None = None