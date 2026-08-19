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

options = PdfPipelineOptions(
    do_ocr=False,
)

converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
result = converter.convert("/Users/pepealms/Documents/Agent4U/backend/data/Big Data ESP 7.pdf")
result.document.save_as_markdown("/Users/pepealms/Documents/Agent4U/backend/data/Big Data ESP 7.md")

# EXTRACCION DE CHUNKS Y CONTEXTUALIZACION

chunker = HybridChunker()
chunks = chunker.chunk(dl_doc=result.document)

# for i, chunk in enumerate(islice(chunks, 5)):
#    contextualized = chunker.contextualize(chunk)
#    print(f"============CHUNK {i}============")
#    print(f"Chunk {i} original: {chunk.text}")
#    print(f"Chunk {i} contextualized: {contextualized}")

texts_to_embed = []
clean_chunks = []

for chunk in chunks:
    text = chunker.contextualize(chunk)
    if len(text) >= 100:
        clean_chunks.append(text)
        texts_to_embed.append(f"passage: {text}")

# EXTRACCION DE VECTORES

embedder = TextEmbedding(model_name="intfloat/multilingual-e5-large")

# documents = ["la lista de la compra 1 es: huevos, leche, pan",
#               "la lista de la compra 2 es: huevos, leche, pan, queso",
#               "la lista de la compra 3 es: huevos, leche, pan, queso, jamón",
#               "el coche es de color rojo y tiene 4 puertas",]

embedder_generator = embedder.embed(texts_to_embed)
vectors = np.array(list(embedder_generator))

# def cosine_similarity(a, b):
#     return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# print(vectors[1])

# sim_1_2 = cosine_similarity(vectors[0], vectors[1])
# sim_1_4 = cosine_similarity(vectors[0], vectors[3])

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

for i, (chunk, vector) in enumerate(zip(clean_chunks, vectors)):
    point = PointStruct(
        id=i,
        vector=vector.tolist(),
        payload={"chunk": chunk}
    )
    if i == 0:
        points = [point]
    else:
        points.append(point)

qdrant_client.upsert(
    collection_name="Test_1",
    points=points
)
