"""Endpoint de app/api/routers/query.py (streaming SSE)."""


def test_conversacion_inexistente_devuelve_404(client):
    respuesta = client.post("/preguntar", json={"query": "¿Y esto?", "conversacion_id": "9999"})

    assert respuesta.status_code == 404


def test_consulta_valida_devuelve_un_stream_sse(client, parsear_sse):
    respuesta = client.post("/preguntar", json={"query": "¿Que es CAP?"})

    assert respuesta.status_code == 200
    assert respuesta.headers["content-type"].startswith("text/event-stream")

    eventos = parsear_sse([respuesta.text])
    assert [e["tipo"] for e in eventos] == ["inicio", "fuentes", "texto", "texto", "fin"]
    assert "".join(e["texto"] for e in eventos if e["tipo"] == "texto") == "Hola mundo"


def test_conversacion_id_vacio_se_trata_como_nuevo_hilo(client):
    respuesta = client.post("/preguntar", json={"query": "¿Que es CAP?", "conversacion_id": ""})

    assert respuesta.status_code == 200
