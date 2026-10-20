"""Configuracion del worker de ARQ.

ARQ necesita una clase con ciertos atributos para arrancar el worker.
`on_startup` carga los modelos pesados (Docling, embedders, QdrantClient)
una sola vez y los guarda en `ctx`, que ARQ pasa a cada job.
"""

from arq.connections import RedisSettings

from app.core.config import get_settings
from app.worker.jobs import indexar_job


async def startup(ctx: dict) -> None:
    """Carga los modelos al arrancar. Solo se ejecuta una vez."""
    from docling.chunking import HybridChunker
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
    from fastembed import SparseTextEmbedding, TextEmbedding
    from qdrant_client import QdrantClient
    from transformers import AutoTokenizer

    settings = get_settings()

    ctx["dense_embedder"] = TextEmbedding(model_name="intfloat/multilingual-e5-large")
    ctx["sparse_embedder"] = SparseTextEmbedding(model_name="Qdrant/bm25", language="spanish")
    ctx["qdrant"] = QdrantClient(url=settings.qdrant_url)

    opciones_pdf = PdfPipelineOptions(do_ocr=False, do_table_structure=True)
    ctx["converter"] = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=opciones_pdf),
        }
    )

    tokenizer = HuggingFaceTokenizer(
        tokenizer=AutoTokenizer.from_pretrained("intfloat/multilingual-e5-large"),
        max_tokens=500,
    )
    ctx["chunker"] = HybridChunker(tokenizer=tokenizer)


async def shutdown(ctx: dict) -> None:
    qdrant = ctx.get("qdrant")
    if qdrant is not None:
        qdrant.close()


class WorkerSettings:
    functions = [indexar_job]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = get_settings().index_max_concurrentes
    job_timeout = 7200
    on_startup = startup
    on_shutdown = shutdown
