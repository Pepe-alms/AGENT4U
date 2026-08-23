import datetime
from sqlalchemy import String, Integer, DateTime, Text
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
    num_chunks: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)