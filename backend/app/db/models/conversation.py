import datetime
import secrets
from sqlalchemy import String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import ForeignKey, JSON, Index

from app.db.models.document import Base


def id_5_cifras() -> int:
    """Id aleatorio de 5 cifras (10000-99999), no enumerable."""
    return 10000 + secrets.randbelow(90000)


class Conversacion(Base):
    __tablename__ = "conversaciones"

    id: Mapped[int] = mapped_column(primary_key=True, default=id_5_cifras)
    titulo: Mapped[str] = mapped_column(String(256), default="Nueva conversación")
    usuario: Mapped[str] = mapped_column(String(128), default="local", index=True)
    creada_en: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.now
    )
    actualizada_en: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.now, onupdate=datetime.datetime.now
    )

    mensajes: Mapped[list["Mensaje"]] = relationship(
        back_populates="conversacion",
        cascade="all, delete-orphan",
        order_by="Mensaje.creado_en",
    )

class Mensaje(Base):
    __tablename__ = "mensajes"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversacion_id: Mapped[int] = mapped_column(
        ForeignKey("conversaciones.id", ondelete="CASCADE")
    )
    rol: Mapped[str] = mapped_column(String(16))
    contenido: Mapped[str] = mapped_column(Text)
    fuentes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    creado_en: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.now
    )

    conversacion: Mapped["Conversacion"] = relationship(back_populates="mensajes")


Index("ix_mensajes_conv_fecha", Mensaje.conversacion_id, Mensaje.creado_en)