"""Endpoints de app/api/routers/conversations.py."""
from app.db.crud import conversation as conversation_crud


def test_listar_sin_conversaciones_devuelve_lista_vacia(client):
    respuesta = client.get("/conversaciones")

    assert respuesta.status_code == 200
    assert respuesta.json() == []


def test_obtener_conversacion_inexistente_devuelve_404(client):
    respuesta = client.get("/conversaciones/9999")

    assert respuesta.status_code == 404
    assert respuesta.json()["detail"] == "Conversación no encontrada"


def test_obtener_conversacion_devuelve_sus_mensajes(client, db):
    conv = conversation_crud.crear_conversacion(db, titulo="Hilo", usuario="local")
    conversation_crud.anadir_mensaje(db, conv.id, rol="user", contenido="Hola")

    respuesta = client.get(f"/conversaciones/{conv.id}")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["titulo"] == "Hilo"
    assert [m["contenido"] for m in cuerpo["mensajes"]] == ["Hola"]


def test_eliminar_conversacion_inexistente_devuelve_404(client):
    respuesta = client.delete("/conversaciones/9999")

    assert respuesta.status_code == 404


def test_eliminar_conversacion_existente_devuelve_200(client, db):
    conv = conversation_crud.crear_conversacion(db, titulo="Hilo", usuario="local")

    respuesta = client.delete(f"/conversaciones/{conv.id}")

    assert respuesta.status_code == 200
    assert respuesta.json() == {"status": "eliminada", "id": conv.id}
