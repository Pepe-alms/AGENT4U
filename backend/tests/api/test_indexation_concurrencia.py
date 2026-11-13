"""Comportamiento de la cola desde la capa HTTP.

Tras la migracion a cola, la indexacion no bloquea la peticion. Los tests del
semaforo ya no aplican. Lo que queda por verificar es que el cupo (429) se
respeta mirando `cola.en_vuelo()`.
"""
from app.core.config import get_settings




async def test_con_cupo_se_devuelve_202(cliente_async, cuerpo_indexar):
    respuesta = await cliente_async.post("/indexar", json=cuerpo_indexar)
    assert respuesta.status_code == 202


async def test_sin_cupo_se_devuelve_429_con_retry_after(cliente_async, monkeypatch, cuerpo_indexar):
    monkeypatch.setattr(get_settings(), "index_max_concurrentes", 0)
    monkeypatch.setattr(get_settings(), "index_max_en_cola", 0)

    respuesta = await cliente_async.post("/indexar", json=cuerpo_indexar)

    assert respuesta.status_code == 429
    assert respuesta.headers["retry-after"] == "120"


async def test_cola_llena_no_crea_documento(cliente_async, monkeypatch, db, cuerpo_indexar):
    """Un 429 no debe dejar ni fila en la BD."""
    from app.db.crud import document as document_crud

    monkeypatch.setattr(get_settings(), "index_max_concurrentes", 0)
    monkeypatch.setattr(get_settings(), "index_max_en_cola", 0)

    await cliente_async.post("/indexar", json=cuerpo_indexar)

    assert document_crud.listar_documentos(db) == []
