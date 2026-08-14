
from pydantic import BaseModel

## validamos que el contenido de la consolta como minimo tenga un campo query de tipo string
class Consulta(BaseModel):
    query: str

class Indexar(BaseModel):
    ruta_archivo: str
    nombre: str