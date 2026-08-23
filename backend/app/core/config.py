
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

import os
import sys
from dotenv import load_dotenv

load_dotenv()
gemini_api_key = os.getenv("GEMINI_API_KEY")

# Paso 1: Definir la configuración de la aplicación
#   - BaseSettings de Pydantic para manejar la configuración de la aplicación.
#   - SettingsConfigDict para especificar el archivo .env y el prefijo de las variables de entorno.
#   - 

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")
    qdrant_url: str = "http://localhost:6333"
    gemini_api_key: str = gemini_api_key
    llm_model: str = "gemini/gemini-flash-lite-latest"
    db_url: str = "sqlite:///./agent4u.db"

@lru_cache()
def get_settings() -> Settings:
    return Settings()

