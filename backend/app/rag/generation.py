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

# def parse_and_validate_response(response: str) -> dict:

#     try:
#         json_match = re.search(r'\{.*\}', response, re.DOTALL)
#         if not json_match:
#             return {
#                 "respuesta": "La respuesta no tiene el formato JSON esperado.",
#                 "fuentes": []
#             }
        
#         json_str = json_match.group(0)
#         data = json.loads(json_str)

#         if not isinstance(data, dict):
#             raise ValueError("Respuesta no es un diccionario")

#         respuesta = data.get("respuesta", "").strip()
#         if not respuesta:
#             raise ValueError("Campo 'respuesta' vacío o ausente")
        
#         fuentes = data.get("fuentes", [])
#         if not isinstance(fuentes, list):
#             fuentes = []

#         fuentes_limpias = [
#             f for f in fuentes
#             if isinstance(f, dict) and f.get("documento") and isinstance(f.get("documento"), str)
#         ]
#         return {
#             "respuesta": respuesta,
#             "fuentes": fuentes_limpias
#         }
    
#     except json.JSONDecodeError:
#         return {
#             "respuesta": "La respuesta no tiene el formato JSON esperado.",
#             "fuentes": []
#         }
#     except Exception as e:
#         print(f"Error parsing response: {e}")
#         return {
#             "respuesta": "No encuentro esa información en el documento.",
#             "fuentes": []
#         }



# def generate_response(query: str, chunks: list[dict], model: str) -> dict:

#     context = build_context(chunks)

#     system_prompt = """Eres un asistente que responde preguntas basándote ÚNICAMENTE en el contexto proporcionado.

#                         FORMATO DE RESPUESTA:
#                         Debes responder siempre en JSON con esta estructura exacta:
#                         {
#                         "respuesta": "Tu respuesta aquí, sin citas ni referencias",
#                         "fuentes": [
#                             {"documento": "nombre_del_archivo.pdf", "pagina": [7, 8]},
#                             {"documento": "otro_archivo.md", "pagina": []}
#                         ]
#                         }

#                         REGLAS ESTRICTAS:
#                         - Responde solo con información presente en el contexto. No uses conocimiento previo.
#                         - La "respuesta" debe ser texto limpio, SIN números entre corchetes ni citas.
#                         - En "fuentes", lista cada documento y página de donde sacaste información para responder.
#                         - Si el contexto no contiene la respuesta, devuelve:
#                         {
#                             "respuesta": "No encuentro esa información en el documento.",
#                             "fuentes": []
#                         }
#                         - No inventes ni completes con lo que sepas. Si no está en el contexto, no lo incluyas.
#                         - Para el campo "pagina": usa una lista vacía [] si el documento no tiene página (como markdown).
#                         - Cada fuente debe corresponder a un fragmento específico usado en la respuesta."""

#     prompt = f"Contexto:{context} Consulta:{query}"

#     raw_response = litellm.completion(
#         model = model,
#         messages = [{"role": "user", "content": prompt},
#                     {"role": "system", "content": system_prompt}])

#     return parse_and_validate_response(raw_response.choices[0].message.content)


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

SYSTEM_PROMPT_STREAMING = """Eres un asistente que responde preguntas basándote ÚNICAMENTE en el contexto proporcionado y en el historial de la conversación.

REGLAS ESTRICTAS:
- Responde solo con información presente en el contexto. No uses conocimiento previo ni inventes datos.
- Si el contexto no contiene la respuesta, dilo explícitamente: "No encuentro esa información en los documentos."
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
