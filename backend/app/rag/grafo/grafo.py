from typing import TypeDict

# Estes es el esquema del objeto que se usara en los nodos de LangGraph para almacenar el estado de la conversación y la información relevante para la recuperación de documentos.

class EstadoRAG(TypeDict, total=False):
    query: str
    historial: list
    consulta_busqueda: str
    chunks: list[dict]
    intentos: int
    contexto_pobre: bool
    messages: list[dict]

def crear_grafo(dense_embedder, sparse_embedder, qdrant, cross_encoder, model):

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

    def decidir(estado: EstadoRAG):
        if not estad.get("contexto_pobre"):
            return "reconstruir"
        if estado.get("intentos", 0) >= 2:
            return "construir"
        return "reescribir"

    return {
        "dense_embedder": dense_embedder,
        "sparse_embedder": sparse_embedder,
        "qdrant": qdrant,
        "cross_encoder": cross_encoder,
        "model": model,
        "nodo_reformular": nodo_reformular,
        "nodo_buscar": nodo_buscar,
        "nodo_evaluar": nodo_evaluar,
        "nodo_reescribir": nodo_reescribir,
        "decidir": decidir,
    }