"""Indexa en Qdrant los documentos nuevos añadidos para el set de preguntas
dificiles (tests/response_file_dificil.json): 18-replicacion-particionado.md
y 19-resiliencia-microservicios.md, pensados para solaparse tematicamente
con documentos ya existentes (02-bases-datos-nosql.md, 11-observabilidad-
servicios.md, 13-seguridad-apis.md, 14-colas-mensajeria.md) y poner a
prueba si el grafo discrimina bien entre fuentes parecidas.

No es un test de pytest: escribe en la base de datos y en Qdrant reales.

Uso:
    uv run python tests/index_hard_docs.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.chunking import HybridChunker
from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
from transformers import AutoTokenizer
from fastembed import SparseTextEmbedding, TextEmbedding
from qdrant_client import QdrantClient

from app.core.config import get_settings
from app.core.exceptions import DocumentoYaExiste
from app.db.session import SessionLocal, crear_esquema
from app.services.indexation_service import indexar_documento

DATA_DIR = Path(__file__).parent / "data"
DOCUMENTOS = ["18-replicacion-particionado.md", "19-resiliencia-microservicios.md"]


def main() -> None:
    settings = get_settings()
    crear_esquema()

    dense_embedder = TextEmbedding(model_name="intfloat/multilingual-e5-large")
    sparse_embedder = SparseTextEmbedding(model_name="Qdrant/bm25", language="spanish")
    qdrant = QdrantClient(url=settings.qdrant_url)

    opciones_pdf = PdfPipelineOptions(do_ocr=False, do_table_structure=True)
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opciones_pdf)}
    )
    tokenizer = HuggingFaceTokenizer(
        tokenizer=AutoTokenizer.from_pretrained("intfloat/multilingual-e5-large"),
        max_tokens=500,
    )
    chunker = HybridChunker(tokenizer=tokenizer)

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
