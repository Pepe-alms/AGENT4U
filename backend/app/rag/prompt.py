"""Construccion de prompts y mensajes para el LLM.

Este modulo no hace llamadas al LLM: solo compone texto y listas de
mensajes. Las funciones que si llaman al LLM viven en app.rag.generation.
"""

SYSTEM_PROMPT_STREAMING = """Eres un asistente que responde preguntas basándote ÚNICAMENTE en el contexto proporcionado y en el historial de la conversación.

REGLAS ESTRICTAS:
- Responde solo con información presente en el contexto. No uses conocimiento previo ni inventes datos.
- Evalúa el contexto de este turno de forma independiente del historial: si contiene la respuesta a la pregunta actual, respóndela aunque el historial trate de un tema distinto. El historial nunca es motivo para descartar información que sí está en el contexto.
- Si, y solo si, el contexto no contiene la respuesta, dilo explícitamente: "No encuentro esa información en los documentos."
- Excepción a la regla anterior: si la pregunta es sobre si dos o más temas ya tratados en la conversación están relacionados entre sí (no pide un dato nuevo), puedes responder con tu propio criterio aunque esa relación no esté escrita en el contexto. Deja claro que es una apreciación tuya y no un hecho extraído de los documentos.
- Responde en prosa clara y natural, sin JSON, sin números de cita entre corchetes ni referencias a documentos: las fuentes se muestran aparte en la interfaz.
- Usa el historial solo para entender referencias de la conversación (a qué se refieren pronombres, preguntas anteriores, etc.); la respuesta debe centrarse en la pregunta actual."""

SYSTEM_PROMPT_REESCRIBIR = """Reescribe la consulta de búsqueda que te doy. La consulta original no ha encontrado resultados útiles en la base documental.

    Reglas:
    - Usa sinónimos o términos alternativos para los conceptos clave.
    - Puedes generalizar un poco si la consulta era muy específica.
    - La nueva consulta debe ser claramente distinta de la original, no una variación mínima.
    - Conserva el tema y el idioma.
    - Responde ÚNICAMENTE con la nueva consulta, sin explicaciones ni comillas."""

SYSTEM_PROMPT_MULTICONSULTA = """Analiza la pregunta y decide si trata de UN solo tema o de VARIOS temas distintos que habría que buscar por separado en una base documental.

    Reglas:
    - Si la pregunta trata de un solo tema, devuelve UNA sola subconsulta: la pregunta tal cual.
    - Solo divide si la pregunta menciona dos o más temas claramente distintos.
    - Cada subconsulta debe ser autónoma y entenderse sin leer las demás.
    - Máximo 3 subconsultas.
    - Responde ÚNICAMENTE con un JSON: {"subconsultas": ["...", "..."]}

    Ejemplos:
    Pregunta: "¿Qué exige la forma normal de Boyce-Codd?"
    {"subconsultas": ["¿Qué exige la forma normal de Boyce-Codd?"]}

    Pregunta: "¿Qué compromisos de diseño plantean la normalización relacional y el teorema CAP?"
    {"subconsultas": ["compromisos de diseño en la normalización relacional", "compromisos de diseño del teorema CAP"]}"""


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


def prompt_reescribir(consulta: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT_REESCRIBIR},
        {"role": "user", "content": consulta},
    ]


def prompt_multiconsulta(consulta: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT_MULTICONSULTA},
        {"role": "user", "content": consulta},
    ]


def prompt_reformular(query: str, historial: list) -> str:
    historial_texto = "\n".join([f"{m.rol}: {m.contenido}" for m in historial])
    return f"Historial de conversación:\n{historial_texto}\n\nNueva consulta: {query}\n\nReformula la consulta para que sea más clara y específica, manteniendo el mismo significado. Devuelve solo la consulta reformulada."


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
