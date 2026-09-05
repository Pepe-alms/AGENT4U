import operator
from typing import Annotated, TypedDict
from langgraph.types import Send
from app.rag.generation import reformular_consulta, reescribir_consulta, descomponer_consulta
from app.rag.retrieval import search_chunks
from app.rag.prompt import generate_query, descomponer_consulta

def acumular(actual: list | None, nuevo: list | None) -> list:
    if nuevo is None:
        return []
    return (actual or []) + nuevo

class EstadoRAG(TypedDict, total=False):
    query: str
    historial: list
    consulta_busqueda: str
    chunks_parciales: Annotated[list[dict], acumular]
    chunks: list[dict]
    intentos: int
    contexto_pobre: bool
    messages: list[dict]
    subconsultas: list[str]
    valor_maximo: float

def crear_nodos(dense_embedder, sparse_embedder, qdrant, cross_encoder, model):

    def multiconsulta(estado: EstadoRAG):
        subconsultas = descomponer_consulta(
            estado["consulta_busqueda"],
            model=model,
        )
        return {
            "subconsultas": subconsultas,
        }

    def repartir(estado:EstadoRAG):
        return [Send(
            "buscar", 
            {"consulta_busqueda": subconsulta}) 
            for subconsulta in estado["subconsultas"]]

    def nodo_reformular(estado: EstadoRAG):
        consulta = reformular_consulta(
            estado["query"],
            estado.get("historial", []),
            model,
        )
        return {
            "consulta_busqueda": consulta,
            "intentos": 0,
        }

    def nodo_buscar(estado: EstadoRAG):
        consulta = estado["consulta_busqueda"]
        chunks = search_chunks(
            consulta,
            dense_embedder,
            sparse_embedder,
            qdrant,
            cross_encoder,
        )
        for c in chunks:
            c["subconsulta"] = consulta
        return {"chunks_parciales": chunks}

    def nodo_evaluar(estado: EstadoRAG):
        chunks = estado.get("chunks", [])
        mejor_score = max((c["score"] for c in chunks), default=-99)
        return {
            "contexto_pobre": mejor_score <= 0,
            "valor_maximo": mejor_score,
        }

    def nodo_reescribir(estado: EstadoRAG):

        nueva_consulta = reescribir_consulta(
            estado["consulta_busqueda"],
            model=model,
        )
        return {
            "consulta_busqueda": nueva_consulta,
            "intentos": estado.get("intentos", 0) + 1,
            "chunks_parciales": None,
        }

    def decidir_reconsulta(estado: EstadoRAG):
        if not estado.get("contexto_pobre"):
            return "construir"
        if estado.get("valor_maximo", 0) < -1:
            return "construir"
        if estado.get("intentos", 0) >= 2:
            return "construir"
        return "reescribir"

    def nodo_construir(estado: EstadoRAG):
        message = generate_query(
            estado["query"],
            estado.get("chunks", []),
            estado.get("historial", [])
        )
        return {
            "messages": message,
        }

    def nodo_fusionar(estado: EstadoRAG):
        chunks = estado.get("chunks_parciales", [])
        if not chunks:
            return {"chunks": []}

        por_rama: dict[str, list[dict]] = {}
        for c in chunks:
            por_rama.setdefault(c.get("subconsulta", ""), []).append(c)

        presupuesto = 9
        cuota = max(1, presupuesto // len(por_rama))

        seleccionados: list[dict] = []
        for rama in por_rama.values():
            rama.sort(key=lambda c: c["score"], reverse=True)
            seleccionados.extend(rama[:cuota])

        vistos: set[str] = set()
        finales: list[dict] = []
        for c in sorted(seleccionados, key=lambda c: c["score"], reverse=True):
            clave = c["chunk"]
            if clave in vistos:
                continue
            vistos.add(clave)
            finales.append(c)

        return {"chunks": finales}

    return {
        "repartir": repartir,
        "multiconsulta": multiconsulta,
        "reformular": nodo_reformular,
        "buscar": nodo_buscar,
        "evaluar": nodo_evaluar,
        "reescribir": nodo_reescribir,
        "construir": nodo_construir,
        "decidir": decidir_reconsulta,
        "fusionar": nodo_fusionar,
    }