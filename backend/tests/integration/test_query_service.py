"""Integracion de app/services/query_service.py.

El grafo y el LLM se sustituyen por dobles: aqui no se mide la calidad de la
respuesta, sino la orquestacion de la conversacion (crear o reutilizar hilo,
que historial recibe el grafo y que se persiste al terminar el stream).
"""
import pytest

from app.core.exceptions import ConversacionNoEncontrada
from app.db.crud import conversation as conversation_crud
from app.services.query_service import responder

MODELO = "modelo-de-prueba"


def preguntar(db, grafo, query="¿Que es el teorema CAP?", conversacion_id=None):
    return responder(
        db=db,
        query=query,
        conversacion_id=conversacion_id,
        dense_embedder=None,
        sparse_embedder=None,
        cross_encoder=None,
        qdrant=None,
        model=MODELO,
        grafo=grafo,
    )


def test_sin_id_crea_una_conversacion_nueva_con_titulo_de_la_consulta(db, grafo, llm):
    preguntar(db, grafo)

    conversaciones = conversation_crud.listar_conversaciones(db, usuario="local")
    assert len(conversaciones) == 1
    assert conversaciones[0].titulo == "¿Que es el teorema CAP?"


def test_una_consulta_larga_recorta_el_titulo_por_palabra_entera(db, grafo, llm):
    larga = (
        "¿Que compromisos de diseño plantean la normalizacion relacional "
        "y el teorema CAP en sistemas distribuidos?"
    )

    preguntar(db, grafo, query=larga)

    titulo = conversation_crud.listar_conversaciones(db, usuario="local")[0].titulo
    assert len(titulo) <= 60
    assert not titulo.endswith(" ")
    assert larga.startswith(titulo)


def test_la_pregunta_del_usuario_se_guarda_antes_de_responder(db, grafo, llm):
    preguntar(db, grafo)

    conv = conversation_crud.listar_conversaciones(db, usuario="local")[0]
    mensajes = conversation_crud.obtener_ultimos_mensajes(db, conv.id)
    assert [(m.rol, m.contenido) for m in mensajes] == [("user", "¿Que es el teorema CAP?")]


def test_un_id_inexistente_lanza_conversacion_no_encontrada(db, grafo, llm):
    with pytest.raises(ConversacionNoEncontrada):
        preguntar(db, grafo, conversacion_id=9999)

    assert conversation_crud.listar_conversaciones(db, usuario="local") == []
    assert grafo.estados_recibidos == []


def test_una_conversacion_existente_se_reutiliza_y_el_grafo_recibe_el_historial(db, grafo, llm):
    conv = conversation_crud.crear_conversacion(db, titulo="Hilo previo", usuario="local")
    conversation_crud.anadir_mensaje(db, conv.id, rol="user", contenido="¿Que es CAP?")
    conversation_crud.anadir_mensaje(db, conv.id, rol="assistant", contenido="Un teorema.")

    # Se consume el generador: el grafo corre al emitir, no al construirlo. El
    # trabajo contra la base de datos si es inmediato, y por eso los tests que
    # solo miran la conversacion no necesitan consumir nada.
    list(preguntar(db, grafo, query="¿Y por que?", conversacion_id=conv.id))

    assert len(conversation_crud.listar_conversaciones(db, usuario="local")) == 1

    estado = grafo.estados_recibidos[0]
    assert estado["query"] == "¿Y por que?"
    assert [m.contenido for m in estado["historial"]] == ["¿Que es CAP?", "Un teorema."]


def test_al_consumir_el_stream_se_emiten_los_eventos_y_se_persiste_la_respuesta(db, grafo, llm, parsear_sse):
    generador = preguntar(db, grafo)

    eventos = parsear_sse(list(generador))

    # Un 'paso' por nodo que termina, antes de las fuentes y del texto.
    assert [e["tipo"] for e in eventos] == [
        "inicio", "paso", "paso", "fuentes", "texto", "texto", "fin",
    ]

    fuentes = next(e for e in eventos if e["tipo"] == "fuentes")["fuentes"]
    assert fuentes == [{
        "nombre": "cap.pdf",
        "origen": "/docs/cap.pdf",
        "headings": ["Teorema CAP"],
        "paginas": [7],
        "texto": "CAP dice que...",
        "score": 0.9,
        "subconsulta": "",
    }]

    conv = conversation_crud.listar_conversaciones(db, usuario="local")[0]
    mensajes = conversation_crud.obtener_ultimos_mensajes(db, conv.id)
    assert [m.rol for m in mensajes] == ["user", "assistant"]
    assert mensajes[1].contenido == "Hola mundo"
    assert mensajes[1].fuentes[0]["nombre"] == "cap.pdf"


def test_al_llm_se_le_pasan_los_mensajes_del_grafo_en_modo_streaming(db, grafo, llm):
    list(preguntar(db, grafo))

    assert len(llm.llamadas) == 1
    llamada = llm.llamadas[0]
    assert llamada["model"] == MODELO
    assert llamada["stream"] is True
    assert llamada["messages"] == grafo.resultado["messages"]


def test_si_el_llm_falla_se_emite_un_evento_error_y_no_se_guarda_respuesta(db, grafo, llm_que_falla, parsear_sse):
    generador = preguntar(db, grafo)

    eventos = parsear_sse(list(generador))

    assert [e["tipo"] for e in eventos] == ["inicio", "paso", "paso", "fuentes", "error"]
    assert "429" in eventos[-1]["mensaje"]

    conv = conversation_crud.listar_conversaciones(db, usuario="local")[0]
    mensajes = conversation_crud.obtener_ultimos_mensajes(db, conv.id)
    assert [m.rol for m in mensajes] == ["user"]


def test_cada_nodo_emite_un_paso_con_sus_cifras(db, grafo_con_pasos, llm, parsear_sse):
    """Los 'paso' llevan hechos, no frases: el frontend pone las palabras.

    Existe porque este evento se puede perder sin que nada se queje: el parser
    SSE del frontend ignoraba 'paso' y la unica señal era que la pantalla se
    quedaba quieta. Ni error en consola, ni fallo de red.
    """
    eventos = parsear_sse(list(preguntar(db, grafo_con_pasos)))

    pasos = [e for e in eventos if e["tipo"] == "paso"]
    assert [p["nodo"] for p in pasos] == [
        "multiconsulta", "buscar", "fusionar", "evaluar", "construir",
    ]
    # Cada paso trae su duracion, y las cifras propias de su nodo.
    assert all(isinstance(p["ms"], int) for p in pasos)
    assert pasos[0]["subconsultas"] == 3
    assert pasos[1]["fragmentos"] == 2
    assert pasos[2]["fragmentos"] == 1
    assert pasos[3] == {**pasos[3], "score": 4.5, "pobre": False}
    # 'construir' no aporta cifras: solo el nodo y el tiempo.
    assert set(pasos[4]) == {"tipo", "nodo", "ms"}
