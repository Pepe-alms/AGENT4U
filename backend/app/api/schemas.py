import datetime
from pydantic import ConfigDict
from pydantic import BaseModel
from pydantic import field_validator

## validamos que el contenido de la consolta como minimo tenga un campo query de tipo string
class QueryRequest(BaseModel):
    query: str
    conversacion_id: str | None = None

    @field_validator("conversacion_id", mode="before")
    @classmethod
    def _vacio_a_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v
class IndexRequest(BaseModel):
    file_path: str
    name: str
    type: str
    size: int | None = None
class IndexUrlRequest(BaseModel):
    url: str
    size: int | None = None
class MensajeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rol: str
    contenido: str
    fuentes: list | None = None
    creado_en: datetime.datetime
class ConversacionResumenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    titulo: str
    creada_en: datetime.datetime
    actualizada_en: datetime.datetime
class ConversacionDetalleOut(ConversacionResumenOut):
    mensajes: list[MensajeOut]