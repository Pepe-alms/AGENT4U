import json
from collections.abc import Iterator
import litellm
from app.db.session import SessionLocal
from app.db.crud import conversation as conversation_crud


def traductor_evento (tipo: str, datos: dict) -> str:
    return f"data: {json.dumps({'tipo': tipo, **datos}, ensure_ascii=False)}\n\n"


def fuente_desde_chunk(c: dict) -> dict:
    """Lo que de un fragmento recuperado viaja al cliente.

    Hasta ahora se descartaban el texto y la puntuacion, que ya venian
    calculados de ``retrieval.cross_encode``: sin ellos el panel de fuentes no
    puede enseñar ni de donde sale la respuesta ni como de relevante es.

    ``subconsulta`` es la pregunta derivada que encontro el fragmento, no la
    que escribio el usuario: con multiconsulta son distintas, y saber cual fue
    es la mitad de la trazabilidad de un RAG agentico.
    """
    return {
        "nombre": c["nombre"],
        "origen": c.get("origen", "") or c.get("url", "") or "",
        "headings": c.get("headings", []),
        "paginas": c.get("paginas", []),
        "texto": c.get("chunk", ""),
        "score": c.get("score"),
        "subconsulta": c.get("subconsulta", ""),
    }


def responder_stream(messages: list[dict],
        conversacion_id,
        model,
        chunks,) -> Iterator[str]:
    """Emite las fuentes y despues la respuesta del modelo, token a token.

    No emite 'inicio': lo hace query_service antes de arrancar el grafo, para
    que el cliente tenga el id de la conversacion mientras se ejecutan los
    pasos y no al final.
    """

    def generar() -> Iterator[str]:
        fuentes = [fuente_desde_chunk(c) for c in chunks]
        yield traductor_evento("fuentes", {"fuentes": fuentes})

        partes: list[str] = []
        try:
            stream = litellm.completion(
                model=model,
                messages=messages,
                stream=True,
            )
            for trozo in stream:
                texto = trozo.choices[0].delta.content
                if not texto:
                    continue
                partes.append(texto)
                yield traductor_evento("texto", {"texto": texto})
        except Exception as e:
            yield traductor_evento("error", {"mensaje": str(e)})
            return

        completa = "".join(partes)
        with SessionLocal() as sesion:
            conversation_crud.anadir_mensaje(
                sesion, conversacion_id, rol="assistant",
                contenido=completa, fuentes=fuentes,
            )

        yield traductor_evento("fin", {})

    return generar()
