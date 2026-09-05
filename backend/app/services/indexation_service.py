import os
from app.db.crud import document as document_crud
from app.core.exceptions import DocumentoYaExiste, FalloIngesta
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.rag.vectorization import embed_texts, normalize_text, borrar_por_origen

def indexar_documento(db: Session, file_path: str, converter, chunker, dense_embedder, sparse_embedder, qdrant, type, size: int):
    origin = file_path
    name = os.path.basename(file_path)
    try:
        doc = document_crud.crear_documento(db, origin, name, type, size)
    except IntegrityError:
        db.rollback()
        raise DocumentoYaExiste(origin)
    try:
        chunks, records = normalize_text(file_path=file_path, converter=converter, chunker=chunker, name=name, type=type)
        embed_texts(chunks=chunks, dense_embedder=dense_embedder, sparse_embedder=sparse_embedder, qdrant=qdrant, records=records)
        document_crud.marcar_indexado(db, doc, len(chunks))
        return {"status": "indexado", "num_chunks": len(chunks)}
    except Exception as e:
        borrar_por_origen(qdrant, origin)
        document_crud.marcar_error(db, doc, str(e))
        raise FalloIngesta(origin, str(e))
