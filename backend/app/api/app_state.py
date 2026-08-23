from contextlib import asynccontextmanager
from fastapi import FastAPI

## Embeder y QdrantClient

# Embeder Denso
from fastembed import TextEmbedding
# Embeder Dispersa
from fastembed import SparseTextEmbedding
# CrossEncoder
from fastembed.rerank.cross_encoder import TextCrossEncoder

from qdrant_client import QdrantClient
from app.core.config import get_settings

## Ingesta
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.chunking import HybridChunker

## Tokenizador
from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
from transformers import AutoTokenizer

## SQL

from app.db.document_sesion import crear_esquema



@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    app.state.dense_embedder = TextEmbedding(model_name="intfloat/multilingual-e5-large")
    app.state.sparse_embedder = SparseTextEmbedding(model_name= "Qdrant/bm25", language= "spanish")
    app.state.cross_encoder = TextCrossEncoder(model_name = "jinaai/jina-reranker-v2-base-multilingual")

    app.state.qdrant = QdrantClient(url=settings.qdrant_url)

    opciones_pdf = PdfPipelineOptions(do_ocr=False, do_table_structure=True)

    app.state.converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=opciones_pdf),
        }
    )

    tokenizer = HuggingFaceTokenizer(
        tokenizer=AutoTokenizer.from_pretrained("intfloat/multilingual-e5-large"),
        max_tokens=500,)
    app.state.chunker = HybridChunker(tokenizer=tokenizer)

    sesion = crear_esquema()

    yield
    app.state.qdrant.close()