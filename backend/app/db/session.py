from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.db.models.document import Base
# El modelo de conversaciones registra sus tablas en el mismo Base al importarse.
from app.db.models import conversation as _conversation_models  # noqa: F401

from collections.abc import Generator
from sqlalchemy.orm import Session

settings = get_settings()

engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def crear_esquema() -> None:
    Base.metadata.create_all(engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

        