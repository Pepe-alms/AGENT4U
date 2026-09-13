"""Indexa en Qdrant todos los documentos del directorio tests/data.

Recorre el directorio, omite los documentos que ya estan indexados y continua
con el resto si alguno falla, de forma que se puede relanzar sin problemas
para completar una indexacion a medias.

No es un test de pytest: escribe en la base de datos y en Qdrant reales, por
lo que Qdrant tiene que estar levantado (docker compose up -d qdrant).

Uso:
    uv run python tests/evaluation/index_all_docs.py
    uv run python tests/evaluation/index_all_docs.py 01-normalizacion-bases-datos.md 02-bases-datos-nosql.md
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.chunking import HybridChunker
from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
from transformers import AutoTokenizer
from fastembed import SparseTextEmbedding, TextEmbedding
from qdrant_client import QdrantClient

from app.core.config import get_settings
from app.core.exceptions import DocumentoYaExiste, FalloIngesta
from app.db.session import SessionLocal, crear_esquema
from app.services.indexation_service import indexar_documento

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
EXTENSIONES = {".md", ".pdf", ".docx", ".html", ".txt"}


def documentos(nombres: list[str]) -> list[Path]:
    """Devuelve los ficheros a indexar: los indicados por nombre o, si no se
    pasa ninguno, todos los de DATA_DIR con una extension soportada."""
    if nombres:
        return [DATA_DIR / nombre for nombre in nombres]
    return sorted(
        ruta
        for ruta in DATA_DIR.iterdir()
        if ruta.is_file() and ruta.suffix.lower() in EXTENSIONES
    )


def main(nombres: list[str]) -> None:
    settings = get_settings()
    crear_esquema()

    rutas = documentos(nombres)
    if not rutas:
        print(f"No hay documentos que indexar en {DATA_DIR}")
        return

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

    indexados, omitidos, fallidos = 0, 0, []

    with SessionLocal() as db:
        for numero, ruta in enumerate(rutas, start=1):
            print(f"[{numero}/{len(rutas)}] Indexando {ruta.name}...")
            if not ruta.is_file():
                print("    no existe, se omite")
                fallidos.append(ruta.name)
                continue
            try:
                resultado = indexar_documento(
                    db=db,
                    file_path=str(ruta),
                    converter=converter,
                    chunker=chunker,
                    dense_embedder=dense_embedder,
                    sparse_embedder=sparse_embedder,
                    qdrant=qdrant,
                    size=ruta.stat().st_size,
                    type=ruta.suffix.lstrip(".").lower(),
                )
                print(f"    OK: {resultado}")
                indexados += 1
            except DocumentoYaExiste:
                print("    ya estaba indexado, se omite")
                omitidos += 1
            except FalloIngesta as e:
                print(f"    ERROR: {e}")
                fallidos.append(ruta.name)

    print(f"\nIndexados: {indexados} | Omitidos: {omitidos} | Fallidos: {len(fallidos)}")
    if fallidos:
        print("Fallidos: " + ", ".join(fallidos))
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
