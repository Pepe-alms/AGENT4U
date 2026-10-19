import time
from collections.abc import Iterator

from app.db.crud import conversation as conversation_crud
from app.core.exceptions import ConversacionNoEncontrada
from app.rag.streaming import responder_stream, traductor_evento


def obtener_o_crear_conversacion(db, conversacion_id, query):
    if conversacion_id is None:
        titulo = query[:60].rsplit(" ", 1)[0] if len(query) > 60 else query
        return conversation_crud.crear_conversacion(db, titulo=titulo, usuario="local")

    conversacion = conversation_crud.obtener_conversacion(db, conversacion_id)
    if conversacion is None:
        raise ConversacionNoEncontrada(conversacion_id)
    return conversacion


def datos_del_paso(nodo: str, actualizacion: dict) -> dict:
    """Las cifras que distinguen un paso de otro, sin texto para el usuario.

    El backend manda hechos y el frontend pone las palabras: asi la etiqueta se
    traduce o se reescribe sin tocar el servidor, y aqui no se decide nada de
    presentacion.
    """
    if nodo == "multiconsulta":
        return {"subconsultas": len(actualizacion.get("subconsultas") or [])}
    if nodo == "buscar":
        return {"fragmentos": len(actualizacion.get("chunks_parciales") or [])}
    if nodo == "fusionar":
        return {"fragmentos": len(actualizacion.get("chunks") or [])}
    if nodo == "evaluar":
        return {
            "score": actualizacion.get("valor_maximo"),
            "pobre": bool(actualizacion.get("contexto_pobre")),
        }
    if nodo == "reescribir":
        return {"intento": actualizacion.get("intentos", 0)}
    return {}


def responder(db, query, conversacion_id, dense_embedder, sparse_embedder,
              cross_encoder, qdrant, model, grafo,
              max_fragmentos: int | None = None) -> Iterator[str]:
    """Ejecuta el grafo emitiendo un evento por nodo, y luego la respuesta.

    El trabajo contra la base de datos se hace **antes** de devolver el
    generador: la sesion la inyecta FastAPI por peticion y se cierra en cuanto
    el endpoint devuelve, mientras que el generador lo consume despues
    StreamingResponse. Lo que haga falta de la sesion, se lee aqui.
    """

    conv = obtener_o_crear_conversacion(db, conversacion_id, query)
    historial = conversation_crud.obtener_ultimos_mensajes(db, conv.id, limit=6)
    conversation_crud.anadir_mensaje(db, conv.id, rol="user", contenido=query)
    # Se guarda el entero, no el objeto: fuera de la sesion queda desligado.
    conv_id = conv.id

    entrada = {"query": query, "historial": historial}
    # Solo se manda si se pidio: asi el grafo conserva su valor por defecto.
    if max_fragmentos is not None:
        entrada["max_fragmentos"] = max_fragmentos

    def generar() -> Iterator[str]:
        yield traductor_evento("inicio", {"conversacion_id": conv_id})

        # `updates` entrega el nombre del nodo que acaba de terminar junto con
        # lo que escribio en el estado. Es lo unico que permite contar el
        # tiempo de cada paso: con `invoke` el grafo entero era una caja negra
        # y el usuario miraba una pantalla quieta hasta el primer token.
        estado: dict = {}
        marca = time.perf_counter()
        for tramo in grafo.stream(entrada, stream_mode="updates"):
            for nodo, actualizacion in tramo.items():
                ahora = time.perf_counter()
                actualizacion = actualizacion or {}
                # El estado completo se rehace a mano porque `updates` solo
                # trae lo que cambio. Solo hacen falta dos claves, y cada una
                # la escribe un unico nodo, asi que gana la ultima.
                for clave in ("chunks", "messages"):
                    if clave in actualizacion:
                        estado[clave] = actualizacion[clave]

                yield traductor_evento(
                    "paso",
                    {
                        "nodo": nodo,
                        "ms": round((ahora - marca) * 1000),
                        **datos_del_paso(nodo, actualizacion),
                    },
                )
                marca = ahora

        yield from responder_stream(
            messages=estado.get("messages", []),
            conversacion_id=conv_id,
            model=model,
            chunks=estado.get("chunks", []),
        )

    return generar()
