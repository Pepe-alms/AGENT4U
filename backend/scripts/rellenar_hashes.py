"""Rellena las huellas de deduplicacion de los documentos que ya existen.

Los documentos indexados antes de la deduplicacion no tienen:

- `hash_content` (SHA-256 del fichero): se calcula leyendo el fichero de su
  `origin`, si todavia existe (los subidos estan en uploads/).
- `hash_texto_normalizado` (huella del texto, ver app/services/huellas.py): se
  calcula desde el DoclingDocument guardado en APP_CONTENIDOS_DIR, sin volver
  a convertir. Los que no tengan contenido guardado se quedan sin ella;
  genera antes su contenido con scripts/generar_contenido.py.

Al terminar ENSEÑA los grupos de documentos existentes que resultan
duplicados entre si (mismo fichero o mismo texto). No borra ni cambia el
estado de ninguno: eso lo decide quien lo lanza.

Por defecto es un ensayo: abre la base de datos en solo lectura, dice que
rellenaria y que duplicados hay, y no escribe nada. Con --aplicar, migra la
base si hace falta y guarda las huellas.

Con Docker Compose, desde la raiz del repo (la API y el worker pueden seguir
arriba: solo se escriben columnas que nadie mas toca):
    docker compose run --rm -v "$PWD/backend/scripts:/app/scripts:ro" \\
        worker python scripts/rellenar_hashes.py            # ensayo
    docker compose run --rm -v "$PWD/backend/scripts:/app/scripts:ro" \\
        worker python scripts/rellenar_hashes.py --aplicar  # guardar

Sin Docker, desde backend/:
    uv run python scripts/rellenar_hashes.py [--aplicar]
"""

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, inspect, text

from app.core.config import get_settings
from app.services import contenidos
from app.services.huellas import hash_fichero, hash_texto_normalizado


def _motor_lectura(url: str):
    """La misma base, abierta en solo lectura si es SQLite en disco."""
    if url.startswith("sqlite:///") and ":memory:" not in url:
        ruta = Path(url.removeprefix("sqlite:///")).resolve()
        return create_engine(f"sqlite:///file:{ruta}?mode=ro&uri=true")
    return create_engine(url)


def _calcular(filas: list[dict]) -> list[dict]:
    """Las huellas que faltan, sin escribir nada. Una entrada por documento."""
    resultado = []
    for fila in filas:
        nuevo = dict(fila)
        if fila["hash_content"] is None:
            origen = Path(fila["origin"])
            nuevo["hash_content"] = hash_fichero(origen) if origen.is_file() else None
            nuevo["fichero_falta"] = not origen.is_file()
        if fila.get("hash_texto_normalizado") is None:
            documento = contenidos.cargar_documento(fila["id"])
            nuevo["hash_texto_normalizado"] = hash_texto_normalizado(documento) if documento else None
            nuevo["contenido_falta"] = documento is None
        resultado.append(nuevo)
    return resultado


def _grupos(filas: list[dict], campo: str) -> list[list[dict]]:
    por_huella: dict[str, list[dict]] = defaultdict(list)
    for fila in filas:
        if fila.get(campo):
            por_huella[fila[campo]].append(fila)
    return [grupo for grupo in por_huella.values() if len(grupo) > 1]


def main(argumentos: list[str] | None = None, motor=None) -> int:
    opciones = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    opciones.add_argument("--aplicar", action="store_true", help="Guardar las huellas (por defecto, solo ensayo).")
    aplicar = opciones.parse_args(argumentos).aplicar
    url = get_settings().db_url

    if aplicar:
        from app.db.migrar import migrar

        migrar(motor)
    motor = motor or (create_engine(url) if aplicar else _motor_lectura(url))

    columnas = {c["name"] for c in inspect(motor).get_columns("documents")}
    tiene_texto = "hash_texto_normalizado" in columnas
    campos = "id, name, origin, state, hash_content" + (", hash_texto_normalizado" if tiene_texto else "")
    with motor.connect() as conexion:
        filas = [dict(f._mapping) for f in conexion.execute(text(f"SELECT {campos} FROM documents ORDER BY id"))]

    calculadas = _calcular(filas)
    por_rellenar = [
        (antes, despues) for antes, despues in zip(filas, calculadas)
        if despues["hash_content"] != antes["hash_content"]
        or despues.get("hash_texto_normalizado") != antes.get("hash_texto_normalizado")
    ]

    print(f"{len(filas)} documentos; {len(por_rellenar)} con alguna huella por rellenar.")
    for _, fila in por_rellenar:
        print(f"  [{fila['id']}] {fila['name']} ({fila['state']})")

    # Los que se quedan sin alguna huella: no se pueden comparar en ese nivel.
    incompletos = [f for f in calculadas if f.get("fichero_falta") or f.get("contenido_falta")]
    if incompletos:
        print("\nSin poder calcular alguna huella:")
        for fila in incompletos:
            faltas = [m for m, falta in (("su fichero ya no existe", fila.get("fichero_falta")),
                                         ("sin contenido guardado", fila.get("contenido_falta"))) if falta]
            print(f"  [{fila['id']}] {fila['name']} ({fila['state']}): {', '.join(faltas)}")

    for titulo, campo in (("el mismo fichero", "hash_content"), ("el mismo texto", "hash_texto_normalizado")):
        grupos = _grupos(calculadas, campo)
        if grupos:
            print(f"\nDocumentos existentes con {titulo} (no se ha tocado ninguno):")
            for grupo in grupos:
                print("  - " + " = ".join(f"[{f['id']}] {f['name']} ({f['state']})" for f in grupo))

    if not aplicar:
        print("\nEnsayo: no se ha escrito nada. Para guardar las huellas: --aplicar")
        return 0

    with motor.begin() as conexion:
        for _, fila in por_rellenar:
            conexion.execute(
                text("UPDATE documents SET hash_content = :hc, hash_texto_normalizado = :ht WHERE id = :id"),
                {"hc": fila["hash_content"], "ht": fila.get("hash_texto_normalizado"), "id": fila["id"]},
            )
    print(f"\nGuardadas las huellas de {len(por_rellenar)} documentos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
