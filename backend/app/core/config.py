
from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "Agent4U"
    gemini_api_key: str | None = None
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

    # --- Modelos ---
    # La API los usa para consultar y el worker para indexar. Viven aqui, y
    # solo aqui, porque si uno cambia y el otro no se indexa con un modelo y
    # se consulta con otro sin que nada falle: solo empeoran las respuestas.
    modelo_denso: str = "intfloat/multilingual-e5-large"
    # Tiene que coincidir con la salida de `modelo_denso`. Solo se usa al crear
    # la coleccion: cambiarlo con la coleccion ya creada obliga a recrearla.
    dimension_densa: int = 1024
    modelo_disperso: str = "Qdrant/bm25"
    idioma_disperso: str = "spanish"
    modelo_reranker: str = "jinaai/jina-reranker-v2-base-multilingual"
    # Techo de tokens por fragmento, medido con el tokenizer de `modelo_denso`.
    chunk_max_tokens: int = 500
    # Donde se descargan los modelos: fastembed (embedders y reranker), el
    # tokenizer de transformers y Docling. Una sola carpeta para todo, fuera
    # de la temporal: fastembed usaba por defecto la del sistema, que macOS
    # vacia, y en Docker su /tmp se pierde al recrear el contenedor. En Docker
    # es /models, montada desde esta misma carpeta del host.
    modelos_dir: str = "~/.cache/agent4u/modelos"

    # Donde se guarda el contenido completo de cada documento (Markdown y
    # DoclingDocument en JSON), ver app/services/contenidos.py. Por defecto
    # backend/contenidos, ignorada por git; en Docker, un volumen que
    # comparten api (que lo sirve) y worker (que lo escribe).
    contenidos_dir: str = str(Path(__file__).resolve().parents[2] / "contenidos")

    @property
    def ruta_modelos(self) -> Path:
        return Path(self.modelos_dir).expanduser()

    @property
    def ruta_contenidos(self) -> Path:
        return Path(self.contenidos_dir).expanduser()

    # --- Redis ---
    redis_url: str = "redis://localhost:6379"

    # --- Indexacion ---
    # Cuantas indexaciones corren A LA VEZ. Uno por defecto, y no es timidez:
    # Docling y ONNX ya usan todos los nucleos por su cuenta, asi que dos
    # indexaciones simultaneas no van a la mitad de velocidad cada una, van
    # peor. Subirlo solo tiene sentido con nucleos de sobra.
    index_max_concurrentes: int = 1
    # Cuantas pueden ESPERAR su turno en la cola de Redis. Pasado
    # concurrentes + en_cola, POST /indexar* responde 429 en vez de encolar:
    # sin este techo, una avalancha llena la cola de trabajos (y el disco de
    # subidas) que el worker tardaria horas en despachar.
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

