"""Unitarios de la logica pura del grafo (app/rag/grafo/grafo_nodes.py).

'acumular' y 'nodo_fusionar' deciden que fragmentos llegan al LLM cuando una
pregunta se abre en varias subconsultas. No llaman a nada externo: fusionar se
obtiene de crear_nodos() pasando None en las dependencias, porque ese nodo no
usa ni embedders ni Qdrant.
"""
import pytest

from app.rag.grafo.grafo_nodes import acumular, crear_nodos


@pytest.fixture
def fusionar():
    return crear_nodos(None, None, None, None, None)["fusionar"]


def frag(texto: str, score: float, subconsulta: str = "a") -> dict:
    return {"chunk": texto, "score": score, "subconsulta": subconsulta}


class TestAcumular:
    """Reductor de chunks_parciales: suma ramas en paralelo y permite resetear."""

    def test_desde_vacio_devuelve_lo_nuevo(self):
        assert acumular(None, [1, 2]) == [1, 2]

    def test_concatena_manteniendo_el_orden(self):
        assert acumular([1, 2], [3]) == [1, 2, 3]

    def test_nuevo_none_limpia_lo_acumulado(self):
        assert acumular([1, 2, 3], None) == []

    def test_todo_none_devuelve_lista_vacia(self):
        assert acumular(None, None) == []


class TestNodoFusionar:

    def test_sin_parciales_devuelve_lista_vacia(self, fusionar):
        assert fusionar({}) == {"chunks": []}
        assert fusionar({"chunks_parciales": []}) == {"chunks": []}

    def test_una_rama_ordena_por_score_descendente(self, fusionar):
        estado = {"chunks_parciales": [frag("bajo", 0.1), frag("alto", 0.9), frag("medio", 0.5)]}

        resultado = fusionar(estado)

        assert [c["chunk"] for c in resultado["chunks"]] == ["alto", "medio", "bajo"]

    def test_una_rama_se_queda_con_el_presupuesto_completo(self, fusionar):
        estado = {
            "chunks_parciales": [frag(f"f{i}", i / 100) for i in range(15)],
            "max_fragmentos": 9,
        }

        resultado = fusionar(estado)

        assert len(resultado["chunks"]) == 9

    def test_sin_max_fragmentos_usa_el_valor_por_defecto_de_settings(self, fusionar, monkeypatch):
        from app.core.config import get_settings
        monkeypatch.setattr(get_settings(), "max_fragmentos_defecto", 7)
        estado = {"chunks_parciales": [frag(f"f{i}", i / 100) for i in range(15)]}

        resultado = fusionar(estado)

        assert len(resultado["chunks"]) == 7

    @pytest.mark.parametrize("max_fragmentos, ramas", [(6, 3), (5, 2), (2, 4), (1, 3)])
    def test_varias_subconsultas_no_superan_max_fragmentos(self, fusionar, max_fragmentos, ramas):
        """Con mas ramas que presupuesto, la cuota minima de uno por rama se
        pasaba del total pedido."""
        letras = "abcdefgh"[:ramas]
        estado = {
            "chunks_parciales": [
                frag(f"{letra}{i}", 0.5, subconsulta=letra)
                for letra in letras
                for i in range(5)
            ],
            "max_fragmentos": max_fragmentos,
        }

        resultado = fusionar(estado)

        # Puede quedarse por debajo (la cuota es una division entera), nunca
        # por encima. Y ninguna rama se queda sin representar si cabe.
        assert 0 < len(resultado["chunks"]) <= max_fragmentos
        ramas_presentes = {c["subconsulta"] for c in resultado["chunks"]}
        assert len(ramas_presentes) == min(ramas, max_fragmentos)

    def test_dos_ramas_reparten_cuota_y_ninguna_monopoliza(self, fusionar):
        rama_a = [frag(f"a{i}", 0.9, subconsulta="a") for i in range(6)]
        rama_b = [frag(f"b{i}", 0.1, subconsulta="b") for i in range(6)]

        resultado = fusionar({"chunks_parciales": rama_a + rama_b, "max_fragmentos": 8})

        textos = [c["chunk"] for c in resultado["chunks"]]
        assert len(textos) == 8
        assert sum(1 for t in textos if t.startswith("a")) == 4
        assert sum(1 for t in textos if t.startswith("b")) == 4

    def test_tres_ramas_reparten_tres_cada_una(self, fusionar):
        ramas = [
            frag(f"{letra}{i}", 0.5, subconsulta=letra)
            for letra in ("a", "b", "c")
            for i in range(5)
        ]

        resultado = fusionar({"chunks_parciales": ramas, "max_fragmentos": 9})

        assert len(resultado["chunks"]) == 9

    def test_deduplica_el_mismo_texto_recuperado_por_dos_ramas(self, fusionar):
        estado = {"chunks_parciales": [
            frag("repetido", 0.8, subconsulta="a"),
            frag("repetido", 0.3, subconsulta="b"),
            frag("unico", 0.5, subconsulta="b"),
        ]}

        resultado = fusionar(estado)

        textos = [c["chunk"] for c in resultado["chunks"]]
        assert textos == ["repetido", "unico"]
        assert resultado["chunks"][0]["score"] == 0.8

    def test_el_resultado_final_queda_ordenado_por_score(self, fusionar):
        estado = {"chunks_parciales": [
            frag("a-bajo", 0.2, subconsulta="a"),
            frag("b-alto", 0.95, subconsulta="b"),
            frag("a-alto", 0.7, subconsulta="a"),
        ]}

        resultado = fusionar(estado)

        scores = [c["score"] for c in resultado["chunks"]]
        assert scores == sorted(scores, reverse=True)
