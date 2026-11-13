import datetime
from sqlalchemy import String, Integer, DateTime, Float, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    origin: Mapped[str] = mapped_column(String(1024), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(512))
    type: Mapped[str] = mapped_column(String(32))
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hash_content: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    user: Mapped[str] = mapped_column(String(128), default="local")
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.now
    )
    state: Mapped[str] = mapped_column(String(32), default="pendiente")
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    num_chunks: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Nivel 2 de deduplicacion: SHA-256 del texto extraido y normalizado
    # (app/services/huellas.py). Mismo contenido en otro envoltorio (el mismo
    # texto en PDF y en DOCX) da la misma huella.
    hash_texto_normalizado: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    # Si el estado es 'duplicado': el documento que ya tenia ese contenido.
    duplicado_de: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Nivel 3: si el estado es 'pendiente-decision', el documento indexado con
    # el que mas fragmentos comparte, y en que proporcion en cada sentido.
    parecido_a: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pct_nuevo_en_antiguo: Mapped[float | None] = mapped_column(Float, nullable=True)
    pct_antiguo_en_nuevo: Mapped[float | None] = mapped_column(Float, nullable=True)