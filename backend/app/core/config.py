
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

import os
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

    # --- Redis ---
    redis_url: str = "redis://localhost:6379"

    # --- Indexacion ---
    # Cuantas indexaciones corren A LA VEZ. Uno por defecto, y no es timidez:
    # Docling y ONNX ya usan todos los nucleos por su cuenta, asi que dos
    # indexaciones simultaneas no van a la mitad de velocidad cada una, van
    # peor. Subirlo solo tiene sentido con nucleos de sobra.
    index_max_concurrentes: int = 1
    # Cuantas pueden ESPERAR su turno. A partir de ahi se responde 429 en vez
    # de aceptar la peticion: sin este techo, una avalancha llena el threadpool
    # de hilos bloqueados y el proceso se queda sin memoria.
    index_max_en_cola: int = 4
    # Puntos por `upsert`. Subir todos de golpe mantiene en memoria el
    # documento entero vectorizado y manda un unico cuerpo HTTP enorme.
    index_lote_upsert: int = 200

    @property
    def index_max_en_vuelo(self) -> int:
        """Peticiones de indexacion que se aceptan antes de responder 429.

        Es la suma de las que corren y las que esperan turno. Se calcula aqui y
        no en cada sitio que lo necesite: el frontend lo pide por GET /ajustes
        para no tener que escribir el mismo numero otra vez, y dos copias de un
        limite son dos copias que acaban discrepando.
        """
        return self.index_max_concurrentes + self.index_max_en_cola

@lru_cache()
def get_settings() -> Settings:
    return Settings()

