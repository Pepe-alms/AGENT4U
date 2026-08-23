import datetime
from sqlalchemy import String, DateTime, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import ForeignKey, JSON, Index

class Base(DeclarativeBase):
    pass        

class Conversacion(Base):
    __tablename__ = "conversaciones"

    id: Mapped[int] = mapped_column(primary_key=True)
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