"""Borra la coleccion de Qdrant y vuelve a indexar todos los documentos de la BD.

Hace falta una vez, tras el cambio que da a cada fragmento su documento_id: los
puntos anteriores no lo tienen, asi que ni se pueden borrar por documento ni
las fuentes saben de que documento salen.

Recorre la tabla `documents` entera y no se detiene si uno falla: lo deja
marcado como 'error' (con el motivo) y sigue con el siguiente. Al final dice
cuantos fueron bien y cuales fallaron.

Escribe en la base de datos y en Qdrant reales. Las rutas de `origin` tienen
que existir donde se ejecute: los ficheros subidos viven en /uploads dentro de
los contenedores, asi que con Docker se lanza dentro de un contenedor del
worker. La imagen solo copia app/, por eso se monta scripts/ al lanzarlo.

Con Docker Compose, desde la raiz del repo:
    docker compose build api worker
    docker compose stop api worker
    docker compose run --rm -v "$PWD/backend/scripts:/app/scripts:ro" \\
        worker python scripts/reindexar_todo.py
    docker compose up -d api worker

Sin Docker, desde backend/ (con Qdrant arriba y el .env apuntando a el):
    uv run python scripts/reindexar_todo.py

Con --desde-json, cada documento que tenga su DoclingDocument guardado se
trocea desde ese JSON sin volver a convertir el fichero original, que es la
parte cara (minutos por documento). Los que no lo tengan se convierten como
siempre. Sirve para reindexar tras cambiar el troceado o el modelo de
embeddings; no si lo que cambia es la conversion de Docling.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qdrant_client import QdrantClient

from app.core.config import get_settings
from app.db.models.document import Document
from app.db.migrar import migrar
from app.db.session import SessionLocal
from app.rag.modelos import (
    crear_chunker, crear_converter, crear_embedder_denso, crear_embedder_disperso,
)
from app.rag.vectorization import COLLECTION_NAME
from app.services.indexacion import indexar_documento


def main(argumentos: list[str] | None = None) -> int:
    opciones = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    opciones.add_argument(
        "--desde-json", action="store_true",
        help="Trocear desde el DoclingDocument guardado cuando exista, sin convertir.",
    )
    desde_json = opciones.parse_args(argumentos).desde_json
    settings = get_settings()
    migrar()

    # Ids, origenes y nombres de una vez: indexar_documento abre sus propias
    # sesiones, y no conviene tener esta abierta durante horas.
    with SessionLocal() as db:
        documentos = [
            (d.id, d.origin, d.name)
            for d in db.query(Document).order_by(Document.id)
        ]

    if not documentos:
        print("No hay documentos en la base de datos. Nada que reindexar.")
        return 0

    qdrant = QdrantClient(url=settings.qdrant_url)

    print(f"Borrando la coleccion '{COLLECTION_NAME}'...")
    if qdrant.collection_exists(collection_name=COLLECTION_NAME):
        qdrant.delete_collection(collection_name=COLLECTION_NAME)
    # No se crea aqui: la crea, con sus indices, el primer documento que se suba.

    print("Cargando modelos...")
    dense_embedder = crear_embedder_denso(settings)
    sparse_embedder = crear_embedder_disperso(settings)
    converter = crear_converter()
    chunker = crear_chunker(settings)

    correctos, fallidos = 0, []
    for numero, (doc_id, origen, nombre) in enumerate(documentos, start=1):
        print(f"[{numero}/{len(documentos)}] {nombre} (id {doc_id})...", flush=True)
        try:
            num_chunks = indexar_documento(
                doc_id,
                file_path=origen,
                converter=converter,
                chunker=chunker,
                dense_embedder=dense_embedder,
                sparse_embedder=sparse_embedder,
                qdrant=qdrant,
                desde_json=desde_json,
            )
        except Exception as e:
            # indexar_documento ya lo ha marcado como 'error' en la BD.
            print(f"    ERROR: {e}", flush=True)
            fallidos.append(f"{nombre} (id {doc_id})")
            continue

        if num_chunks is None:
            print("    ya no existe en la BD, se omite", flush=True)
            continue
        print(f"    OK: {num_chunks} fragmentos", flush=True)
        correctos += 1

    qdrant.close()

    print(f"\nReindexados: {correctos} | Fallidos: {len(fallidos)}")
    if fallidos:
        print("Fallidos (marcados como 'error'): " + ", ".join(fallidos))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
