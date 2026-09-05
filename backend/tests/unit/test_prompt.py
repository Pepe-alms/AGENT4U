"""Unitarios de la construccion de prompts (app/rag/prompt.py).

Son funciones puras: no llaman al LLM ni tocan Qdrant, asi que no necesitan
dobles. Lo que se fija aqui es el formato exacto del contexto, porque es lo
que el modelo lee para citar documentos y paginas.
"""
from app.rag.prompt import build_context, generate_query, prompt_reformular


def chunk(nombre="manual.pdf", paginas=None, url=None, texto="Contenido del fragmento."):
    datos = {"nombre": nombre, "paginas": paginas if paginas is not None else [], "chunk": texto}
    if url is not None:
        datos["url"] = url
    return datos


class TestBuildContext:

    def test_sin_chunks_devuelve_cadena_vacia(self):
        assert build_context([]) == ""

    def test_un_chunk_incluye_documento_paginas_y_texto(self):
        contexto = build_context([chunk(nombre="cap.pdf", paginas=[7], texto="Texto del capitulo.")])

        assert contexto == "[1] (Documento: cap.pdf, Página: 7, Url: N/A)\nTexto del capitulo."

    def test_varias_paginas_se_listan_separadas_por_coma(self):
        contexto = build_context([chunk(paginas=[3, 4, 5])])

        assert "Página: 3, 4, 5" in contexto

    def test_sin_paginas_muestra_na(self):
        contexto = build_context([chunk(paginas=[])])

        assert "Página: N/A" in contexto

    def test_url_ausente_o_nula_muestra_na(self):
        sin_clave = build_context([chunk()])
        con_none = build_context([chunk(url=None)])

        assert "Url: N/A" in sin_clave
        assert "Url: N/A" in con_none

    def test_url_presente_se_incluye(self):
        contexto = build_context([chunk(url="https://ejemplo.com/doc")])

        assert "Url: https://ejemplo.com/doc" in contexto

    def test_varios_chunks_se_numeran_desde_uno_y_se_separan(self):
        contexto = build_context([
            chunk(nombre="a.pdf", texto="Primero."),
            chunk(nombre="b.pdf", texto="Segundo."),
        ])

        assert contexto.startswith("[1] (Documento: a.pdf")
        assert "\n\n[2] (Documento: b.pdf" in contexto


class TestGenerateQuery:

    def test_sin_historial_devuelve_system_y_pregunta(self):
        messages = generate_query("¿Que es CAP?", [chunk(texto="CAP es un teorema.")], [])

        assert [m["role"] for m in messages] == ["system", "user"]
        assert "¿Que es CAP?" in messages[-1]["content"]
        assert "CAP es un teorema." in messages[-1]["content"]

    def test_el_historial_se_intercala_entre_system_y_la_pregunta(self, mensajes_previos):
        messages = generate_query("¿Y por que?", [], mensajes_previos)

        assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]
        assert messages[1]["content"] == "¿Que es CAP?"
        assert messages[2]["content"] == "Un teorema de sistemas distribuidos."
        assert messages[-1]["content"].endswith("Pregunta: ¿Y por que?")


class TestPromptReformular:

    def test_incluye_historial_y_consulta_nueva(self, mensajes_previos):
        texto = prompt_reformular("¿Y por que?", mensajes_previos)

        assert "user: ¿Que es CAP?" in texto
        assert "assistant: Un teorema de sistemas distribuidos." in texto
        assert "Nueva consulta: ¿Y por que?" in texto
