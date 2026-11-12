from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings

from collections.abc import Generator
from sqlalchemy.orm import Session

settings = get_settings()

engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False, "timeout": 30},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

        