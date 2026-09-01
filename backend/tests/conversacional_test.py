"""Prueba manual del flujo conversacional de /preguntar (SSE).

No es un test de pytest: llama al servidor real (debe estar levantado en
127.0.0.1:8000) y al LLM real. Se usa para comprobar a ojo que:

  - El streaming SSE llega completo (inicio / fuentes / texto* / fin).
  - El historial de la conversacion se va acumulando en la base de datos
    turno a turno.
  - Los mensajes que se le mandan al LLM (system + historial + contexto)
    se construyen como se espera, incluso cuando una pregunta de
    seguimiento depende de lo que se dijo antes.

Uso:
    uv run python tests/conversacional_test.py
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.sesion import SessionLocal
from app.db import record_crud
from app.rag.prompt import generate_query

BASE_URL = "http://127.0.0.1:8000"

# Conversacion con dos temas y follow-ups que solo tienen sentido con
# el historial de por medio.
TURNOS = [
    "¿Qué tres propiedades no pueden garantizarse a la vez según el teorema CAP?",
    "¿Y por qué es imposible garantizar las tres al mismo tiempo?",
    "Cambiando de tema, ¿qué elimina la tercera forma normal en bases de datos relacionales?",
    "¿Puedes darme un ejemplo de ese tipo de dependencia?",
]


def preguntar(query: str, conversacion_id: int | None) -> dict:
    conv_id_str = str(conversacion_id) if conversacion_id is not None else None
    body = json.dumps({"query": query, "conversacion_id": conv_id_str}).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/preguntar", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )

    eventos = {"inicio": None, "fuentes": None, "texto": [], "fin": False, "error": None}
    trazas: list[tuple[float, str, int]] = []  # (t_desde_envio, tipo, bytes_del_frame)

    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as resp:
        for raw_line in resp:
            t = time.perf_counter() - t0
            line = raw_line.decode("utf-8")
            if not line.strip():
                continue
            if not line.startswith("data:"):
                continue
            payload = json.loads(line[len("data:"):].strip())
            tipo = payload.pop("tipo")
            trazas.append((t, tipo, len(raw_line)))
            if tipo == "inicio":
                eventos["inicio"] = payload["conversacion_id"]
            elif tipo == "fuentes":
                eventos["fuentes"] = payload["fuentes"]
            elif tipo == "texto":
                eventos["texto"].append(payload["texto"])
            elif tipo == "error":
                eventos["error"] = payload["mensaje"]
            elif tipo == "fin":
                eventos["fin"] = True

    eventos["respuesta"] = "".join(eventos["texto"])
    eventos["trazas"] = trazas
    return eventos


def analizar_streaming(trazas: list[tuple[float, str, int]]) -> None:
    eventos_texto = [t for t in trazas if t[1] == "texto"]
    n = len(eventos_texto)
    if n == 0:
        print("    [streaming] 0 eventos 'texto' recibidos")
        return

    gaps = [eventos_texto[i][0] - eventos_texto[i - 1][0] for i in range(1, n)]
    duracion_total = eventos_texto[-1][0] - eventos_texto[0][0]
    t_primer_texto = eventos_texto[0][0]

    print(f"    [streaming] {n} eventos 'texto' recibidos")
    print(f"    [streaming] tiempo hasta el primer trozo de texto: {t_primer_texto:.3f}s")
    print(f"    [streaming] duracion del streaming (1er a ultimo trozo): {duracion_total:.3f}s")
    if gaps:
        print(f"    [streaming] gap entre trozos: min={min(gaps):.3f}s max={max(gaps):.3f}s avg={sum(gaps)/len(gaps):.3f}s")
    if n >= 3 and duracion_total > 0.05:
        print("    [streaming] veredicto: llega incremental (varios trozos repartidos en el tiempo)")
    else:
        print("    [streaming] veredicto: SOSPECHOSO - parece llegar todo de golpe, no incremental")


def mostrar_historial(conv_id: int) -> list:
    with SessionLocal() as db:
        historial = record_crud.obtener_ultimos_mensajes(db, conv_id, limit=20)
    print(f"    historial en BD ahora mismo ({len(historial)} mensajes):")
    for m in historial:
        contenido = m.contenido if len(m.contenido) <= 90 else m.contenido[:90] + "..."
        print(f"      [{m.rol}] {contenido}")
    return historial


def mostrar_contexto_montado(historial: list, query: str, chunks: list) -> None:
    messages = generate_query(query, chunks, historial)
    print("    messages que se le mandarian al LLM en el proximo turno:")
    for m in messages:
        contenido = m["content"] if len(m["content"]) <= 200 else m["content"][:200] + "..."
        print(f"      role={m['role']!r} -> {contenido}")


def main() -> None:
    conv_id = None

    for i, pregunta in enumerate(TURNOS, start=1):
        print(f"\n=== Turno {i}: {pregunta}")
        resultado = preguntar(pregunta, conv_id)

        if resultado["error"]:
            print(f"    ERROR: {resultado['error']}")
            break

        conv_id = resultado["inicio"]
        fuentes = {f["nombre"] for f in (resultado["fuentes"] or [])}
        print(f"    conversacion_id = {conv_id}")
        print(f"    fuentes recuperadas: {sorted(fuentes)}")
        print(f"    respuesta: {resultado['respuesta']!r}")
        print(f"    evento fin recibido: {resultado['fin']}")
        analizar_streaming(resultado["trazas"])

        historial = mostrar_historial(conv_id)

        if i == len(TURNOS):
            # Ultimo turno: enseñar como se montaria el contexto para
            # una siguiente pregunta con el historial actual.
            mostrar_contexto_montado(historial, "pregunta de ejemplo", [])


if __name__ == "__main__":
    main()
