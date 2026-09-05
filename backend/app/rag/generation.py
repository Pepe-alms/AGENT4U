
import json

import litellm

from app.rag.prompt import prompt_multiconsulta, prompt_reescribir, prompt_reformular


def reformular_consulta(query: str, historial: list, model: str) -> str:
    if not historial:
        return query

    raw_response = litellm.completion(
        model=model,
        messages=[{"role": "user", "content": prompt_reformular(query, historial)}]
    )

    return raw_response.choices[0].message.content.strip()


def reescribir_consulta(consulta: str, model: str) -> str:
    respuesta = litellm.completion(
        model=model,
        messages=prompt_reescribir(consulta),
    )
    return respuesta.choices[0].message.content.strip()


def descomponer_consulta(consulta: str, model: str) -> list[str]:
    respuesta = litellm.completion(
        model=model,
        messages=prompt_multiconsulta(consulta),
    )
    try:
        texto = respuesta.choices[0].message.content.strip()
        datos = json.loads(texto[texto.index("{"):texto.rindex("}") + 1])
        subconsultas = datos.get("subconsultas", [])
        return subconsultas[:3] if subconsultas else [consulta]
    except Exception:
        return [consulta]
