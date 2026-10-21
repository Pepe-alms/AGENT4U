"""Tests de la cola en memoria (el doble de test de ColaIndexacion).

Verifican que la interfaz se comporta como esperan los endpoints: encolar
suma en vuelo, terminar los descuenta, y close limpia.
"""

from app.services.cola_port import ColaEnMemoria, ColaIndexacion


async def test_implementa_el_protocolo():
    cola = ColaEnMemoria()
    assert isinstance(cola, ColaIndexacion)


async def test_encolar_suma_en_vuelo():
    cola = ColaEnMemoria()
    assert await cola.en_vuelo() == 0

    await cola.encolar("j1", file_path="/a.pdf", type="pdf", size=100)
    assert await cola.en_vuelo() == 1

    await cola.encolar("j2", file_path="/b.pdf", type="pdf", size=200)
    assert await cola.en_vuelo() == 2


async def test_terminado_no_cuenta_como_en_vuelo():
    cola = ColaEnMemoria()
    await cola.encolar("j1", file_path="/a.pdf", type="pdf", size=100)
    await cola.encolar("j2", file_path="/b.pdf", type="pdf", size=200)

    cola.marcar_terminado("j1")
    assert await cola.en_vuelo() == 1

    cola.marcar_terminado("j2")
    assert await cola.en_vuelo() == 0


async def test_close_limpia_todo():
    cola = ColaEnMemoria()
    await cola.encolar("j1", file_path="/a.pdf", type="pdf", size=100)
    await cola.close()

    assert await cola.en_vuelo() == 0
    assert cola.trabajos == []


async def test_encolar_guarda_los_parametros():
    cola = ColaEnMemoria()
    await cola.encolar("j1", file_path="/docs/x.pdf", type="pdf", size=42)

    assert cola.trabajos[0] == {
        "job_id": "j1",
        "file_path": "/docs/x.pdf",
        "type": "pdf",
        "size": 42,
    }
