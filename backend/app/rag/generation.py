import litellm

def build_context(chunks: list[dict]) -> str:
    optimal_vectors = []
    for i, chunk in enumerate(chunks):
        optimal_vectors.append(f"[{chunk['nombre']}]: {chunk['chunk']}")

    context = "\n\n".join(optimal_vectors)
    return context

def generate_response(query: str, chunks: list[dict], model: str) -> str:

    context = build_context(chunks)

    system_prompt = """Eres un asistente que responde preguntas basándote ÚNICAMENTE en el contexto proporcionado.

    Reglas estrictas:
    - Responde solo con información presente en el contexto. No uses conocimiento previo.
    - Si el contexto no contiene la respuesta, di exactamente: "No encuentro esa información en el documento." No inventes ni completes con lo que sepas.
    - Cita el documento del que sacas la informacion con [nombre del documento], con el formato [documento1], [documento2], etc."""

    consulta = f"Contexto:{context} Consulta:{query}"

    respuesta = litellm.completion( 
        model = model,
        messages = [{"role": "user", "content": consulta},
                    {"role": "system", "content": system_prompt}])

    return respuesta.choices[0].message.content