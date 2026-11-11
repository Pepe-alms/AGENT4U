"""El grafo compilado de punta a punta, con el LLM y la busqueda sustituidos.

Existe por un fallo que los tests de nodo sueltos no podian ver: `repartir`
lanza cada rama de busqueda con un Send, y un Send solo lleva lo que se le
pasa. max_fragmentos se quedaba fuera y `buscar` usaba siempre su valor fijo.
"""
import pytest

import app.rag.grafo.grafo_nodes as nodos
from app.core.config import get_settings
from app.rag.grafo.grafo_create import crear_grafo


@pytest.fixture
def busquedas(monkeypatch) -> list[dict]:
    """Anota con que se llamo a cada busqueda y devuelve un fragmento bueno."""
    llamadas: list[dict] = []

    def buscar_falso(consulta, *_deps, max_fragmentos):
        llamadas.append({"consulta": consulta, "max_fragmentos": max_fragmentos})
        return [{"chunk": f"texto de {consulta}", "score": 1.0, "nombre": "a.pdf", "paginas": []}]

    monkeypatch.setattr(nodos, "search_chunks", buscar_falso)
    monkeypatch.setattr(nodos, "reformular_consulta", lambda query, historial, model: query)
    monkeypatch.setattr(nodos, "descomponer_consulta", lambda consulta, model: ["a", "b"])
    return llamadas


def ejecutar(entrada: dict) -> dict:
    grafo = crear_grafo(None, None, None, None, model="modelo-de-prueba")
    return grafo.invoke({"query": "a y b", "historial": [], **entrada})


def test_cada_rama_de_busqueda_recibe_el_max_fragmentos_pedido(busquedas):
    ejecutar({"max_fragmentos": 3})

    assert sorted(b["consulta"] for b in busquedas) == ["a", "b"]
    assert all(b["max_fragmentos"] == 3 for b in busquedas)


def test_sin_max_fragmentos_buscar_usa_el_valor_por_defecto_de_settings(busquedas, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_fragmentos_defecto", 7)

    ejecutar({})

    assert [b["max_fragmentos"] for b in busquedas] == [7, 7]
