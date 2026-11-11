"""Indexa en Qdrant los documentos nuevos añadidos para el set de preguntas
dificiles (response_file_dificil.json): 18-replicacion-particionado.md
y 19-resiliencia-microservicios.md, pensados para solaparse tematicamente
con documentos ya existentes (02-bases-datos-nosql.md, 11-observabilidad-
servicios.md, 13-seguridad-apis.md, 14-colas-mensajeria.md) y poner a
prueba si el grafo discrimina bien entre fuentes parecidas.

No es un test de pytest: escribe en la base de datos y en Qdrant reales.

Uso:
    uv run python tests/evaluation/index_hard_docs.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from qdrant_client import QdrantClient

from app.core.config import get_settings
from app.core.exceptions import DocumentoYaExiste
from app.db.session import SessionLocal, crear_esquema
from app.rag.modelos import (
    crear_chunker, crear_converter, crear_embedder_denso, crear_embedder_disperso,
)
from app.services.indexation_service import indexar_documento

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DOCUMENTOS = ["18-replicacion-particionado.md", "19-resiliencia-microservicios.md"]


def main() -> None:
    settings = get_settings()
    crear_esquema()

    dense_embedder = crear_embedder_denso(settings)
    sparse_embedder = crear_embedder_disperso(settings)
    qdrant = QdrantClient(url=settings.qdrant_url)
    converter = crear_converter()
    chunker = crear_chunker(settings)

    with SessionLocal() as db:
        for nombre in DOCUMENTOS:
            file_path = str(DATA_DIR / nombre)
            print(f"Indexando {nombre}...")
            try:
                resultado = indexar_documento(
                    db=db,
                    file_path=file_path,
                    converter=converter,
                    chunker=chunker,
                    dense_embedder=dense_embedder,
                    sparse_embedder=sparse_embedder,
                    qdrant=qdrant,
                    size=Path(file_path).stat().st_size,
                    type="md",
                )
                print(f"    OK: {resultado}")
            except DocumentoYaExiste:
                print("    ya estaba indexado, se omite")


if __name__ == "__main__":
    main()
