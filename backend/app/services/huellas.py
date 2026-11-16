"""Huellas para detectar documentos duplicados.

- `hash_fichero`: SHA-256 de los bytes. Mismo fichero, aunque se llame
  distinto (nivel 1, al recibirlo).
- `hash_texto_normalizado`: SHA-256 del texto que extrajo Docling, sin lo que
  cambia entre envoltorios del mismo contenido (nivel 2, tras convertir).
"""

import hashlib
import re
import unicodedata
from pathlib import Path

TROZO = 1024 * 1024
_ESPACIOS = re.compile(r"\s+")


def hash_fichero(ruta: str | Path) -> str:
    """SHA-256 de un fichero, leido por trozos: no carga el documento entero."""
    huella = hashlib.sha256()
    with open(ruta, "rb") as fichero:
        while trozo := fichero.read(TROZO):
            huella.update(trozo)
    return huella.hexdigest()


def normalizar_texto(texto: str) -> str:
    """El texto sin lo que cambia entre envoltorios del mismo contenido.

    - NFKC: las ligaduras (`ﬁ`) y los espacios raros que salen distintos al
      convertir un PDF y un DOCX del mismo texto pasan a su forma normal.
    - casefold: mayusculas y minusculas dan igual (y "ß" == "ss").
    - Cualquier racha de espacios, tabuladores y saltos de linea, un espacio:
      cada formato parte las lineas y separa los parrafos a su manera.
    """
    texto = unicodedata.normalize("NFKC", texto).casefold()
    return _ESPACIOS.sub(" ", texto).strip()


def hash_texto_normalizado(documento) -> str:
    """Huella del contenido de un DoclingDocument.

    Sale de `export_to_text()`, que por defecto solo exporta la capa de cuerpo:
    las cabeceras y pies de pagina que Docling reconoce como tales no cuentan.
    """
    return hashlib.sha256(normalizar_texto(documento.export_to_text()).encode("utf-8")).hexdigest()
