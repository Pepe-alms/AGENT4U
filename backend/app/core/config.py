
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

import os
import sys
from dotenv import load_dotenv

load_dotenv()
gemini_api_key = os.getenv("GEMINI_API_KEY")

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "Agent4U"
    gemini_api_key: str = gemini_api_key
    llm_model: str = "gemini/gemini-flash-lite-latest"
    db_url: str = "sqlite:///./agent4u.db"
    # Carpeta donde POST /indexar-fichero deja lo que sube el cliente.
    upload_dir: str = "./uploads"
    # Techo por fichero, en bytes. 50 MB.
    upload_max_bytes: int = 50 * 1024 * 1024
    # Modelos que el cliente puede pedir en POST /preguntar, separados por
    # comas. Es una lista blanca a proposito: aceptar cualquier cadena dejaria
    # que quien use la API apunte a un modelo caro o inexistente.
    llm_modelos: str = "gemini/gemini-flash-lite-latest,gemini/gemini-flash-latest"
    # Fragmentos que se pasan al modelo tras el reordenado.
    max_fragmentos_defecto: int = 10
    max_fragmentos_tope: int = 20

@lru_cache()
def get_settings() -> Settings:
    return Settings()

