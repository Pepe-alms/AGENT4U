from typing import TypedDict
from app.rag.prompt import reformular_consulta, reescribir_consulta
from app.rag.retrieval import search_chunks
from app.rag.prompt import generate_query

# Estes es el esquema del objeto que se usara en los nodos de LangGraph para almacenar el estado de la conversación y la información relevante para la recuperación de documentos.

class EstadoRAG(TypedDict, total=False):
    query: str
    historial: list
    consulta_busqueda: str
    chunks: list[dict]
    intentos: int
    contexto_pobre: bool
    messages: list[dict]

def crear_nodos(dense_embedder, sparse_embedder, qdrant, cross_encoder, model):

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
        chunks = search_chunks(
            estado["consulta_busqueda"],
            dense_embedder,
            sparse_embedder,
            qdrant,
            cross_encoder,
        )
        return {
            "chunks": chunks,
        }

    def nodo_evaluar(estado: EstadoRAG):
        chunks = estado.get("chunks", [])
        contexto_pobre = max((c["score"] for c in chunks), default=-99)
        return {
            "contexto_pobre": contexto_pobre <= 0,
        }

    def nodo_reescribir(estado: EstadoRAG):

        nueva_consulta = reescribir_consulta(
            estado["consulta_busqueda"],
            model=model,
        )
        return {
            "consulta_busqueda": nueva_consulta,
            "intentos": estado.get("intentos", 0) + 1,
        }

    def decidir_reconsulta(estado: EstadoRAG):
        if not estado.get("contexto_pobre"):
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

    return {
        "reformular": nodo_reformular,
        "buscar": nodo_buscar,
        "evaluar": nodo_evaluar,
        "reescribir": nodo_reescribir,
        "construir": nodo_construir,
        "decidir": decidir_reconsulta,
    }