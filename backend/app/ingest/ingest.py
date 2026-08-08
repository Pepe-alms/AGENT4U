
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions

from docling.chunking import HybridChunker

opciones = PdfPipelineOptions(
    do_ocr=False,
)

converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opciones)})
resultado = converter.convert("/Users/pepealms/Documents/Agent4U/backend/data/Big Data ESP 7.pdf")
resultado.document.save_as_markdown("/Users/pepealms/Documents/Agent4U/backend/data/Big Data ESP 7.md")

chunker = HybridChunker()

resultado_chunks = list(chunker.chunk(dl_doc=resultado.document))

print(len(resultado_chunks))
