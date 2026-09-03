from langgraph.graph import StateGraph, START, END
from app.rag.grafo.grafo_nodes import crear_nodos, EstadoRAG


def crear_grafo(dense_embedder, sparse_embedder, qdrant, cross_encoder, model):
    n = crear_nodos(dense_embedder, sparse_embedder, qdrant, cross_encoder, model)

    grafo = StateGraph(EstadoRAG)

    grafo.add_node("multiconsulta", n["multiconsulta"])
    grafo.add_node("reformular", n["reformular"])
    grafo.add_node("buscar", n["buscar"])
    grafo.add_node("evaluar", n["evaluar"])
    grafo.add_node("reescribir", n["reescribir"])
    grafo.add_node("construir", n["construir"])
    grafo.add_node("fusionar", n["fusionar"])

    grafo.add_edge(START, "reformular")
    grafo.add_edge("reformular", "multiconsulta")
    grafo.add_conditional_edges("multiconsulta", n["repartir"], ["buscar"])
    grafo.add_edge("buscar", "fusionar")
    grafo.add_edge("fusionar", "evaluar")
    grafo.add_conditional_edges("evaluar", n["decidir"], ["reescribir", "construir"])
    grafo.add_edge("reescribir", "multiconsulta")
    grafo.add_edge("construir", END)

    return grafo.compile()