"""Construccion de los modelos de ingesta y consulta a partir de Settings.

La API y el worker cargan los mismos modelos en procesos distintos. Si cada
uno escribiera su nombre a mano, bastaria cambiar uno para indexar con un
modelo y consultar con otro sin que nada falle. Por eso los dos pasan por
aqui, y los nombres solo estan en `app/core/config.py`.

Los imports van dentro de cada funcion: Docling, fastembed y transformers
tardan en importarse, y quien importe este modulo solo paga lo que construye.
"""

from app.core.config import Settings, get_settings


def crear_embedder_denso(settings: Settings | None = None):
    from fastembed import TextEmbedding

    settings = settings or get_settings()
    return TextEmbedding(model_name=settings.modelo_denso)


def crear_embedder_disperso(settings: Settings | None = None):
    from fastembed import SparseTextEmbedding

    settings = settings or get_settings()
    return SparseTextEmbedding(model_name=settings.modelo_disperso,
                               language=settings.idioma_disperso)


def crear_cross_encoder(settings: Settings | None = None):
    from fastembed.rerank.cross_encoder import TextCrossEncoder

    settings = settings or get_settings()
    return TextCrossEncoder(model_name=settings.modelo_reranker)


def crear_converter():
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opciones_pdf = PdfPipelineOptions(do_ocr=False, do_table_structure=True)
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=opciones_pdf),
        }
    )


def crear_chunker(settings: Settings | None = None):
    """HybridChunker atado al tokenizer del modelo denso.

    El tokenizer sale de `modelo_denso` a proposito: el limite de tokens que
    importa es el del modelo que va a embeber el fragmento.
    """
    from docling.chunking import HybridChunker
    from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
    from transformers import AutoTokenizer

    settings = settings or get_settings()
    tokenizer = HuggingFaceTokenizer(
        tokenizer=AutoTokenizer.from_pretrained(settings.modelo_denso),
        max_tokens=settings.chunk_max_tokens,
    )
    return HybridChunker(tokenizer=tokenizer)
