from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    backend_url: str = "http://localhost:8000"

    model_config = {"env_prefix": "GATEWAY_"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
