
import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, field_validator

# --------------------------------------------------------------------------
# Alias de dominio
# --------------------------------------------------------------------------

Rol = Literal["user", "assistant"]
EstadoDocumento = Literal["pendiente", "indexado", "error"]


# --------------------------------------------------------------------------
# Errores
# --------------------------------------------------------------------------

class ErrorOut(BaseModel):
    detail: str = Field(
        description="Mensaje legible que explica por que fallo la peticion.",
        examples=["Conversación no encontrada"],
    )


# --------------------------------------------------------------------------
# Peticiones
# --------------------------------------------------------------------------

class QueryRequest(BaseModel):
    """Cuerpo de ``POST /preguntar``."""

    query: str = Field(
        min_length=1,
        max_length=4000,
        description="Pregunta del usuario. No puede estar vacia.",
        examples=["¿Que dice el teorema CAP?"],
    )
    conversacion_id: int | None = Field(
        default=None,
        description=(
            "Hilo al que se añade la pregunta. Si se omite, es null o es una "
            "cadena vacia, se crea una conversacion nueva cuyo titulo son los "
            "primeros 60 caracteres de la pregunta. Si se envia un id que no "
            "existe, la respuesta es 404."
        ),
        examples=[12345],
    )

    @field_validator("conversacion_id", mode="before")
    @classmethod
    def _vacio_a_none(cls, v):
        """Acepta "" como 'sin conversacion': los formularios HTML mandan
        cadena vacia cuando el campo se deja sin rellenar."""
        if isinstance(v, str) and not v.strip():
            return None
        return v


class IndexRequest(BaseModel):
    """Cuerpo de ``POST /indexar``: ingesta de un fichero local."""

    file_path: str = Field(
        min_length=1,
        description=(
            "Ruta del fichero a indexar, accesible desde el proceso del "
            "backend. Se guarda como 'origin' del documento y es unica: "
            "reindexar la misma ruta devuelve 409."
        ),
        examples=["/docs/manual.pdf"],
    )
    type: str = Field(
        min_length=1,
        description=(
            "Etiqueta de formato que se propaga al payload de cada fragmento "
            "en Qdrant. El backend no la valida contra una lista cerrada."
        ),
        examples=["pdf", "md", "docx", "txt"],
    )
    size: int | None = Field(
        default=None,
        ge=0,
        description="Tamaño en bytes, solo informativo. Puede omitirse.",
        examples=[20480],
    )
    name: str | None = Field(
        default=None,
        deprecated=True,
        description=(
            "IGNORADO. El nombre se deriva siempre de 'file_path' con "
            "os.path.basename(). Se mantiene por compatibilidad con clientes "
            "antiguos y se eliminara."
        ),
    )


class IndexUrlRequest(BaseModel):
    """Cuerpo de ``POST /indexar-url``: ingesta de una pagina web.

    Reutiliza el mismo flujo que ``/indexar`` forzando ``type="url"``.
    """

    url: Annotated[
        str,
        Field(
            pattern=r"^https?://",
            description=(
                "URL http(s) a indexar. Se guarda como 'origin' del documento "
                "y es unica: reindexar la misma URL devuelve 409."
            ),
            examples=["https://ejemplo.com/doc"],
        ),
    ]
    size: int | None = Field(
        default=None,
        ge=0,
        description="Tamaño en bytes, solo informativo. Puede omitirse.",
    )


# --------------------------------------------------------------------------
# Respuestas: documentos
# --------------------------------------------------------------------------

class DocumentoOut(BaseModel):
    """Un documento indexado.

    Vista publica de la tabla 'documents': se omiten a proposito 'hash_content'
    y 'user', que son de uso interno.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(description="Identificador interno del documento.")
    origin: str = Field(
        description="Ruta o URL de origen. Unica en toda la tabla.",
        examples=["/docs/manual.pdf"],
    )
    name: str = Field(
        description="Nombre del fichero, derivado de 'origin'. Es la clave que "
                    "usa DELETE /documentos/{documento}.",
        examples=["manual.pdf"],
    )
    type: str = Field(description="Etiqueta de formato.", examples=["pdf"])
    size: int | None = Field(description="Tamaño en bytes, si se informo.")
    created_at: datetime.datetime = Field(
        description="Fecha de alta, en ISO-8601."
    )
    state: EstadoDocumento = Field(description="Estado de la ingesta.")
    num_chunks: int = Field(
        description="Fragmentos generados. Es 0 mientras el estado no sea "
                    "'indexado'."
    )
    error_message: str | None = Field(
        description="Causa del fallo. Solo tiene valor si state == 'error'."
    )


class ListaDocumentosOut(BaseModel):
    """Respuesta de ``GET /documentos``.

    OJO: si no hay ningun documento el endpoint responde 404, no una lista
    vacia. El cliente debe tratar ese 404 como 'coleccion vacia'.
    """

    documentos: list[DocumentoOut]


class DocumentoEliminadoOut(BaseModel):
    """Respuesta de ``DELETE /documentos/{documento}``.

    Hay dos desenlaces con codigo 200 y hay que distinguirlos por 'status':
    'eliminado' (borrado de Qdrant y de la base de datos) y 'fallo en el
    borrado' (Qdrant no pudo borrar los vectores; la fila sigue existiendo).
    """

    status: Literal["eliminado", "fallo en el borrado"] = Field(
        description="Desenlace del borrado."
    )
    documento: str = Field(
        description="Nombre del documento sobre el que se actuo.",
        examples=["manual.pdf"],
    )


class IndexacionOut(BaseModel):
    """Respuesta de ``POST /indexar`` y ``POST /indexar-url``."""

    status: Literal["indexado"] = Field(
        description="Solo se devuelve en caso de exito; los fallos son 409 o 500."
    )
    num_chunks: int = Field(
        ge=0,
        description="Fragmentos generados y almacenados en Qdrant.",
        examples=[2],
    )


# --------------------------------------------------------------------------
# Respuestas: conversaciones
# --------------------------------------------------------------------------

class FuenteOut(BaseModel):
    """Documento del que salio un fragmento usado para responder.

    Se construye en app/rag/streaming.py y viaja por dos caminos: en el evento
    SSE 'fuentes' durante la respuesta, y guardado en el mensaje del asistente.
    """

    model_config = ConfigDict(from_attributes=True)

    nombre: str = Field(
        description="Nombre del documento de origen.", examples=["cap.pdf"]
    )
    origen: str = Field(
        default="",
        description="Ruta o URL completa. Cadena vacia si no se registro.",
        examples=["/docs/cap.pdf"],
    )
    headings: list[str] = Field(
        default_factory=list,
        description="Titulos de seccion que contienen el fragmento.",
        examples=[["Teorema CAP"]],
    )
    paginas: list[int] = Field(
        default_factory=list,
        description="Paginas del documento en las que aparece el fragmento.",
        examples=[[7]],
    )


class MensajeOut(BaseModel):
    """Un mensaje dentro de una conversacion."""

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(description="Identificador interno del mensaje.")
    rol: Rol = Field(description="Quien escribio el mensaje.")
    contenido: str = Field(description="Texto del mensaje.")
    fuentes: list[FuenteOut] | None = Field(
        default=None,
        description=(
            "Documentos citados. Siempre null en los mensajes con rol 'user'; "
            "en los de rol 'assistant' contiene las fuentes recuperadas, que "
            "pueden ser una lista vacia si el buscador no encontro nada."
        ),
    )
    creado_en: datetime.datetime = Field(description="Fecha de alta, en ISO-8601.")


class ConversacionResumenOut(BaseModel):
    """Una conversacion sin sus mensajes. Es lo que devuelve
    ``GET /conversaciones``, ordenado por 'actualizada_en' descendente y
    limitado a las 20 mas recientes."""

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(
        description="Identificador aleatorio de 5 cifras, no enumerable.",
        examples=[12345],
    )
    titulo: str = Field(
        description="Se genera con los primeros 60 caracteres de la primera "
                    "pregunta del hilo.",
        examples=["¿Que dice el teorema CAP?"],
    )
    creada_en: datetime.datetime = Field(description="Fecha de alta, en ISO-8601.")
    actualizada_en: datetime.datetime = Field(
        description="Ultima modificacion, en ISO-8601. Es el criterio de orden "
                    "de GET /conversaciones."
    )


class ConversacionDetalleOut(ConversacionResumenOut):
    """Una conversacion con todos sus mensajes. Es lo que devuelve
    ``GET /conversaciones/{conversacion_id}``."""

    mensajes: list[MensajeOut] = Field(
        description="Mensajes del hilo, del mas antiguo al mas reciente."
    )


class ConversacionEliminadaOut(BaseModel):
    """Respuesta de ``DELETE /conversaciones/{conversacion_id}``."""

    status: Literal["eliminada"]
    id: int = Field(description="Id de la conversacion borrada.", examples=[12345])

class EventoInicio(BaseModel):
    """Primer evento. Informa del hilo al que pertenece la respuesta; es la
    unica forma de conocer el id de una conversacion recien creada."""

    tipo: Literal["inicio"]
    conversacion_id: int = Field(examples=[12345])


class EventoFuentes(BaseModel):
    """Documentos recuperados, enviados antes de generar el texto para poder
    pintarlos mientras se escribe la respuesta. Puede venir vacio."""

    tipo: Literal["fuentes"]
    fuentes: list[FuenteOut]


class EventoTexto(BaseModel):
    """Un trozo de la respuesta. Hay que CONCATENARLOS en orden: cada uno es un
    incremento, no la respuesta completa."""

    tipo: Literal["texto"]
    texto: str = Field(examples=["Hola "])


class EventoError(BaseModel):
    """El modelo fallo a mitad de la generacion. El stream se corta aqui y el
    texto parcial no se persiste. Llega con codigo HTTP 200: un stream que
    empezo bien no puede cambiar su codigo de estado a posteriori."""

    tipo: Literal["error"]
    mensaje: str = Field(description="Causa del fallo.")


class EventoFin(BaseModel):
    """Ultimo evento en caso de exito. La respuesta completa ya esta guardada
    en la conversacion."""

    tipo: Literal["fin"]


EventoSSE = Annotated[
    EventoInicio | EventoFuentes | EventoTexto | EventoError | EventoFin,
    Field(discriminator="tipo"),
]


class EventoStream(RootModel[EventoSSE]):
    """Un evento cualquiera del stream, discriminado por el campo 'tipo'."""
