import enum

import strawberry


@strawberry.type
class Ajustes:
    modelos: list[str]
    max_fragmentos_defecto: int
    max_fragmentos_tope: int
    max_indexaciones_en_vuelo: int


@strawberry.type
class Documento:
    id: int
    origin: str
    name: str
    type: str
    size: int | None
    created_at: str
    state: str
    num_chunks: int
    error_message: str | None
    # Deduplicacion. 'duplicado': duplicado_de es el original (mismo contenido).
    # 'pendiente-decision': parecido_a es el indexado con el que se parece, y
    # los dos porcentajes (0 a 1) cuanto se solapan en cada sentido.
    duplicado_de: int | None = None
    parecido_a: int | None = None
    pct_nuevo_en_antiguo: float | None = None
    pct_antiguo_en_nuevo: float | None = None


@strawberry.type
class ContenidoDocumento:
    documento: Documento
    # Viene de documentos de terceros: el cliente tiene que sanearlo.
    markdown: str
    paginas: int


@strawberry.type
class Trabajo:
    job_id: str
    status: str
    origin: str
    name: str
    num_chunks: int
    error_message: str | None


@strawberry.type
class Fuente:
    nombre: str
    origen: str
    headings: list[str]
    paginas: list[int]
    texto: str
    score: float | None
    subconsulta: str
    # Null en los mensajes guardados antes de que el backend lo enviara.
    documento_id: int | None = None


@strawberry.type
class Mensaje:
    id: int
    rol: str
    contenido: str
    fuentes: list[Fuente] | None
    creado_en: str


@strawberry.type
class ConversacionResumen:
    id: int
    titulo: str
    creada_en: str
    actualizada_en: str


@strawberry.type
class ConversacionDetalle:
    id: int
    titulo: str
    creada_en: str
    actualizada_en: str
    mensajes: list[Mensaje]


@strawberry.type
class SaludQdrant:
    status: str
    coleccion: str
    existe: bool
    detalle: str | None


@strawberry.type
class Salud:
    backend: str
    qdrant: SaludQdrant


@strawberry.enum
class AccionResolver(enum.Enum):
    reemplazar = "reemplazar"
    conservar = "conservar"
    descartar = "descartar"


@strawberry.type
class Resolucion:
    id: int
    accion: str
    # 'en-cola' (sondear trabajo(job_id)) o 'descartado'.
    status: str
    job_id: str | None = None
    reemplazado: int | None = None


@strawberry.type
class TrabajoEncolado:
    job_id: str
    status: str


@strawberry.type
class DocumentoEliminado:
    status: str
    id: int
    documento: str


@strawberry.type
class ConversacionEliminada:
    status: str
    id: int
