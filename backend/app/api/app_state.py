from contextlib import asynccontextmanager
from fastapi import FastAPI

## Embeder y QdrantClient
from fastembed import TextEmbedding
from qdrant_client import QdrantClient
from app.core.config import get_settings

## Ingesta
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.chunking import HybridChunker

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.embedder = TextEmbedding(model_name="intfloat/multilingual-e5-large")
    app.state.qdrant = QdrantClient(url=settings.qdrant_url)

    opciones = PdfPipelineOptions(
    do_ocr=False,)

    app.state.converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opciones)})
    app.state.chunker = HybridChunker()


    yield
    app.state.qdrant.close()