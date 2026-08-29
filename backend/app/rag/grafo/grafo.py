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
            "chunks": resultados,
        }

    return {
        "dense_embedder": dense_embedder,
        "sparse_embedder": sparse_embedder,
        "qdrant": qdrant,
        "cross_encoder": cross_encoder,
        "model": model,
    }