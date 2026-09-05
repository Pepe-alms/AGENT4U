import json
from collections.abc import Iterator
import litellm
from app.db.session import SessionLocal
from app.db.crud import conversation as conversation_crud


def traductor_evento (tipo: str, datos: dict) -> str: 
    return f"data: {json.dumps({'tipo': tipo, **datos}, ensure_ascii=False)}\n\n"


def responder_stream(messages: list[dict],
        conversacion_id,
        model,
        chunks,) -> Iterator[str]:

    def generar() -> Iterator[str]:
        yield traductor_evento("inicio", {"conversacion_id": conversacion_id})

        fuentes = [
            {
                "nombre": c["nombre"],
                "origen": c.get("origen", ""),
                "headings": c.get("headings", []),
                "paginas": c.get("paginas", []),
            }
            for c in chunks
        ]
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
