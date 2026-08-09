from itertools import islice

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions

from docling.chunking import HybridChunker

from fastembed import TextEmbedding
import numpy as np

from app.core.config import get_settings

from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, PointStruct

opciones = PdfPipelineOptions(
    do_ocr=False,
)

converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opciones)})
resultado = converter.convert("/Users/pepealms/Documents/Agent4U/backend/data/Big Data ESP 7.pdf")
resultado.document.save_as_markdown("/Users/pepealms/Documents/Agent4U/backend/data/Big Data ESP 7.md")

# EXTRACCION DE CHUNKS Y CONTEXTUALIZACION 

chunker = HybridChunker()
chunks = chunker.chunk(dl_doc=resultado.document)

# for i, chunk in enumerate(islice(chunks, 5)):
#    contextualizado = chunker.contextualize(chunk)
#    print(f"============CHUNK {i}============")
#    print(f"Chunk {i} original: {chunk.text}")
#    print(f"Chunk {i} contextualizado: {contextualizado}")

textos_para_embeber = []
chunks_limpios = []

for chunk in chunks:
    texto = chunker.contextualize(chunk)
    if len(texto) >= 100:
        chunks_limpios.append(texto)
        textos_para_embeber.append(f"passage: {texto}")

# EXTRACCION DE VECTORES

embeder = TextEmbedding(model_name="intfloat/multilingual-e5-large")

# documentos = ["la lista de la compra 1 es: huevos, leche, pan", 
#               "la lista de la compra 2 es: huevos, leche, pan, queso", 
#               "la lista de la compra 3 es: huevos, leche, pan, queso, jamón",
#               "el coche es de color rojo y tiene 4 puertas",]

embeder_generator = embeder.embed(textos_para_embeber)
vectores = np.array(list(embeder_generator))

# def similitud_coseno(a, b):
#     return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# print(vectores[1])

# sim_1_2 = similitud_coseno(vectores[0], vectores[1])
# sim_1_4 = similitud_coseno(vectores[0], vectores[3])

# print(f"Similitud frase 1 vs 2 (parecidas): {sim_1_2:.4f}")
# print(f"Similitud frase 1 vs 4 (distintas): {sim_1_4:.4f}")


settings = get_settings()
qdrant_client = QdrantClient(url=settings.qdrant_url)

if qdrant_client.collection_exists(collection_name="Test_1"):
    qdrant_client.delete_collection(collection_name="Test_1")

qdrant_client.create_collection(
    collection_name="Test_1", 
    vectors_config=VectorParams(size= 1024, distance=Distance.COSINE)
    )

for i, (chunk, vector) in enumerate(zip(chunks_limpios, vectores)):
    punto =PointStruct(
        id=i,
        vector=vector.tolist(),
        payload={"chunk": chunk}
    )
    if i == 0:
        puntos = [punto]
    else:
        puntos.append(punto)

qdrant_client.upsert(
    collection_name="Test_1",
    points=puntos
)
