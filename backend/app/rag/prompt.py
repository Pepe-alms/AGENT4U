import litellm
import json
import re

def build_context(chunks: list[dict]) -> str:
    contexto_formateado = []
    for i, chunk in enumerate(chunks):
        documento = chunk['nombre']
        paginas = ', '.join(map(str, chunk['paginas'])) if chunk['paginas'] else 'N/A'
        url = chunk.get('url') or 'N/A'
        
        contexto_formateado.append(
            f"[{i+1}] (Documento: {documento}, Página: {paginas}, Url: {url})\n{chunk['chunk']}"
        )
    
    return "\n\n".join(contexto_formateado)

def reformular_consulta(query: str, historial: list[dict], model: str) -> str:
    if not historial:
        return query
    historial_texto = "\n".join([f"{m.rol}: {m.contenido}" for m in historial])
    prompt = f"Historial de conversación:\n{historial_texto}\n\nNueva consulta: {query}\n\nReformula la consulta para que sea más clara y específica, manteniendo el mismo significado. Devuelve solo la consulta reformulada."

    raw_response = litellm.completion(
        model=model,
        messages=[{"role": "user", "content": prompt}]
    )

    return raw_response.choices[0].message.content.strip()

def reescribir_consulta(consulta: str, model: str) -> str:
    system_prompt = """Reescribe la consulta de búsqueda que te doy. La consulta original no ha encontrado resultados útiles en la base documental.

    Reglas:
    - Usa sinónimos o términos alternativos para los conceptos clave.
    - Puedes generalizar un poco si la consulta era muy específica.
    - La nueva consulta debe ser claramente distinta de la original, no una variación mínima.
    - Conserva el tema y el idioma.
    - Responde ÚNICAMENTE con la nueva consulta, sin explicaciones ni comillas."""

    respuesta = litellm.completion(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": consulta},
            ],
        )
    return respuesta.choices[0].message.content.strip()

SYSTEM_PROMPT_STREAMING = """Eres un asistente que responde preguntas basándote ÚNICAMENTE en el contexto proporcionado y en el historial de la conversación.

REGLAS ESTRICTAS:
- Responde solo con información presente en el contexto. No uses conocimiento previo ni inventes datos.
- Evalúa el contexto de este turno de forma independiente del historial: si contiene la respuesta a la pregunta actual, respóndela aunque el historial trate de un tema distinto. El historial nunca es motivo para descartar información que sí está en el contexto.
- Si, y solo si, el contexto no contiene la respuesta, dilo explícitamente: "No encuentro esa información en los documentos."
- Excepción a la regla anterior: si la pregunta es sobre si dos o más temas ya tratados en la conversación están relacionados entre sí (no pide un dato nuevo), puedes responder con tu propio criterio aunque esa relación no esté escrita en el contexto. Deja claro que es una apreciación tuya y no un hecho extraído de los documentos.
- Responde en prosa clara y natural, sin JSON, sin números de cita entre corchetes ni referencias a documentos: las fuentes se muestran aparte en la interfaz.
- Usa el historial solo para entender referencias de la conversación (a qué se refieren pronombres, preguntas anteriores, etc.); la respuesta debe centrarse en la pregunta actual."""


def generate_query(query: str, chunks: list[dict], historial: list) -> list[dict]:

    context = build_context(chunks)

    messages = [{"role": "system", "content": SYSTEM_PROMPT_STREAMING}]

    for m in historial:
        messages.append({"role": m.rol, "content": m.contenido})

    messages.append({
        "role": "user",
        "content": f"Contexto:\n{context}\n\nPregunta: {query}",
    })

    return messages
