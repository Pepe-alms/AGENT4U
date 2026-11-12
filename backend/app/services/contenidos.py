"""El contenido completo de cada documento, tal como lo extrajo Docling.

Por documento se guardan dos ficheros en `Settings.ruta_contenidos`:

- `<id>.md`: el Markdown completo, para leerlo en la aplicacion. Lleva un
  comentario `<!-- pagina N -->` al principio de cada pagina, que no se ve al
  renderizar y permite situarse por pagina (lo usa el visor para saltar desde
  una fuente).
- `<id>.json`: el DoclingDocument entero, para reindexar sin volver a
  convertir el fichero original, que es la parte cara.

Los fragmentos de Qdrant no sirven para esto: se descartan cabeceras, pies y
trozos cortos, y cada uno repite los titulos de su seccion.

Se escriben primero con nombre temporal y solo se renombran a su sitio cuando
la indexacion termina bien (`confirmar`). Si falla, `descartar` borra los
temporales y los definitivos: un documento en error no tiene nada en Qdrant, y
el contenido que se lee tiene que coincidir con el que usa el RAG.
"""

import os
import re
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings

SALTO = "<!-- salto-de-pagina -->"
MARCA_PAGINA = "<!-- pagina {} -->"
PATRON_PAGINA = re.compile(r"<!-- pagina (\d+) -->")


@dataclass(frozen=True)
class Temporales:
    markdown: Path
    json: Path


def _carpeta() -> Path:
    carpeta = get_settings().ruta_contenidos
    carpeta.mkdir(parents=True, exist_ok=True)
    return carpeta


def ruta_markdown(doc_id: int) -> Path:
    return _carpeta() / f"{doc_id}.md"


def ruta_json(doc_id: int) -> Path:
    return _carpeta() / f"{doc_id}.json"


def markdown_con_paginas(documento) -> str:
    """Exporta a Markdown con una marca `<!-- pagina N -->` por pagina.

    Docling solo sabe poner un separador fijo entre paginas, sin numero. El
    numero se reconstruye recorriendo los elementos en el mismo orden en que
    los exporta: cada cambio de pagina entre dos elementos seguidos es un
    separador. Si las cuentas no cuadran (una pagina sin elementos, un orden
    distinto), se guarda sin marcas: mejor no poder saltar por pagina que
    saltar a la equivocada.
    """
    texto = documento.export_to_markdown(page_break_placeholder=SALTO)
    trozos = texto.split(SALTO)

    paginas: list[int] = []
    for elemento, _nivel in documento.iterate_items():
        procedencia = getattr(elemento, "prov", None)
        if procedencia:
            pagina = procedencia[0].page_no
            if not paginas or paginas[-1] != pagina:
                paginas.append(pagina)

    if len(paginas) != len(trozos):
        return "\n\n".join(trozo.strip() for trozo in trozos)
    return "\n\n".join(
        f"{MARCA_PAGINA.format(pagina)}\n\n{trozo.strip()}"
        for pagina, trozo in zip(paginas, trozos)
    )


def guardar_temporales(doc_id: int, documento) -> Temporales:
    """Escribe los dos ficheros con nombre temporal, sin tocar los buenos."""
    temporales = Temporales(
        markdown=ruta_markdown(doc_id).with_suffix(".md.tmp"),
        json=ruta_json(doc_id).with_suffix(".json.tmp"),
    )
    temporales.markdown.write_text(markdown_con_paginas(documento), encoding="utf-8")
    documento.save_as_json(temporales.json)
    return temporales


def confirmar(doc_id: int, temporales: Temporales) -> None:
    """Pone los temporales en su sitio. `os.replace` es atomico: quien lea en
    ese momento ve el fichero viejo o el nuevo, nunca uno a medias."""
    os.replace(temporales.json, ruta_json(doc_id))
    os.replace(temporales.markdown, ruta_markdown(doc_id))


def descartar(doc_id: int) -> None:
    """Borra los temporales y los definitivos de un documento."""
    for ruta in (ruta_markdown(doc_id), ruta_json(doc_id)):
        ruta.unlink(missing_ok=True)
        ruta.with_suffix(ruta.suffix + ".tmp").unlink(missing_ok=True)


def borrar(doc_id: int) -> None:
    """Al borrar el documento, su contenido se va con el."""
    descartar(doc_id)


def leer_markdown(doc_id: int) -> str | None:
    ruta = ruta_markdown(doc_id)
    return ruta.read_text(encoding="utf-8") if ruta.exists() else None


def cargar_documento(doc_id: int):
    """El DoclingDocument guardado, o None si no hay."""
    from docling_core.types.doc import DoclingDocument

    ruta = ruta_json(doc_id)
    return DoclingDocument.load_from_json(ruta) if ruta.exists() else None


def contar_paginas(markdown: str) -> int:
    """Paginas marcadas en el Markdown guardado (0 si se guardo sin marcas)."""
    return len({int(n) for n in PATRON_PAGINA.findall(markdown)})
