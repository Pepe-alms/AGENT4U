"""Huellas para detectar documentos duplicados.

- `hash_fichero`: SHA-256 de los bytes. Mismo fichero, aunque se llame
  distinto (nivel 1, al recibirlo).
- `hash_texto_normalizado`: SHA-256 del texto que extrajo Docling, sin lo que
  cambia entre envoltorios del mismo contenido (nivel 2, tras convertir).
"""

import hashlib
from pathlib import Path

TROZO = 1024 * 1024


def hash_fichero(ruta: str | Path) -> str:
    """SHA-256 de un fichero, leido por trozos: no carga el documento entero."""
    huella = hashlib.sha256()
    with open(ruta, "rb") as fichero:
        while trozo := fichero.read(TROZO):
            huella.update(trozo)
    return huella.hexdigest()
