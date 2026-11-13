"""Genera el contenido guardado de los documentos que no lo tienen.

Los documentos indexados antes de que se guardara el contenido completo (el
Markdown y el DoclingDocument en JSON, ver app/services/contenidos.py) no se
pueden leer en el visor. Este script los convierte otra vez con Docling y
guarda sus dos ficheros, SIN tocar Qdrant ni el estado del documento: sus
fragmentos ya estan indexados y se quedan como estan.

Solo trata los documentos en estado 'indexado'. Los que estan en cola o
indexandose tendran contenido al terminar, y los que estan en error no tienen
nada en Qdrant: darles contenido mostraria un documento que el RAG no usa.

Si uno falla (el fichero original ya no existe, por ejemplo), lo anota y sigue
con el siguiente. Al final dice cuantos fueron bien y cuales fallaron.

Las rutas de `origin` tienen que existir donde se ejecute: con Docker, los
ficheros subidos viven en /uploads dentro de los contenedores, asi que se
lanza dentro del worker. La imagen solo copia app/, por eso se monta scripts/.

Con Docker Compose, desde la raiz del repo:
    docker compose run --rm -v "$PWD/backend/scripts:/app/scripts:ro" \\
        worker python scripts/generar_contenido.py

Sin Docker, desde backend/:
    uv run python scripts/generar_contenido.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.migrar import migrar
from app.db.models.document import Document
from app.db.session import SessionLocal
from app.rag.modelos import crear_converter
from app.services import contenidos


def main() -> int:
    migrar()

    with SessionLocal() as db:
        pendientes = [
            (d.id, d.origin, d.name)
            for d in db.query(Document).filter(Document.state == "indexado").order_by(Document.id)
            if contenidos.leer_markdown(d.id) is None
        ]

    if not pendientes:
        print("Todos los documentos indexados tienen ya su contenido guardado.")
        return 0

    print(f"{len(pendientes)} documentos sin contenido. Cargando Docling...")
    converter = crear_converter()

    correctos, fallidos = 0, []
    for numero, (doc_id, origen, nombre) in enumerate(pendientes, start=1):
        print(f"[{numero}/{len(pendientes)}] {nombre} (id {doc_id})...", flush=True)
        try:
            documento = converter.convert(origen).document
            contenidos.confirmar(doc_id, contenidos.guardar_temporales(doc_id, documento))
        except Exception as e:
            contenidos.descartar(doc_id)
            print(f"    ERROR: {e}", flush=True)
            fallidos.append(f"{nombre} (id {doc_id})")
            continue
        print(f"    OK: {contenidos.contar_paginas(contenidos.leer_markdown(doc_id))} paginas", flush=True)
        correctos += 1

    print(f"\nGenerados: {correctos} | Fallidos: {len(fallidos)}")
    if fallidos:
        print("Fallidos (siguen indexados, sin contenido): " + ", ".join(fallidos))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
