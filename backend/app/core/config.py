
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

# Paso 1: Definir la configuración de la aplicación
#   - BaseSettings de Pydantic para manejar la configuración de la aplicación.
#   - SettingsConfigDict para especificar el archivo .env y el prefijo de las variables de entorno.
#   - 

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")
    qdrant_url: str = "http://localhost:6333"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
