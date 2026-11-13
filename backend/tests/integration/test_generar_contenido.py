"""scripts/generar_contenido.py contra la base en memoria. La carpeta de
contenidos va a tmp_path (fixture autouse de conftest) y Docling se sustituye
por el converter falso: nunca toca datos reales."""
import scripts.generar_contenido as generar
from app.db.crud import document as document_crud
from app.services import contenidos


class ConverterQueFallaCon:
    def __init__(self, interno, ruta_rota: str):
        self._interno = interno
        self._ruta_rota = ruta_rota
        self.convertidos: list[str] = []

    def convert(self, file_path: str):
        self.convertidos.append(file_path)
        if file_path == self._ruta_rota:
            raise FileNotFoundError(file_path)
        return self._interno.convert(file_path)


def preparar(monkeypatch, session_factory, converter):
    convertidor = ConverterQueFallaCon(converter, "/docs/roto.pdf")
    monkeypatch.setattr(generar, "SessionLocal", session_factory)
    monkeypatch.setattr(generar, "migrar", lambda: None)
    monkeypatch.setattr(generar, "crear_converter", lambda: convertidor)
    return convertidor


def indexado(db, origen):
    doc = document_crud.crear_documento(db, origen, origen.rsplit("/", 1)[1], "pdf", 1)
    document_crud.marcar_indexado(db, doc, 3)
    return doc


def test_genera_el_contenido_de_los_indexados_que_no_lo_tienen_y_sigue_si_uno_falla(
    db, monkeypatch, session_factory, converter, documentos_frescos
):
    convertidor = preparar(monkeypatch, session_factory, converter)
    a = indexado(db, "/docs/a.pdf")
    roto = indexado(db, "/docs/roto.pdf")
    b = indexado(db, "/docs/b.pdf")

    assert generar.main() == 1

    assert contenidos.leer_markdown(a.id) is not None
    assert contenidos.leer_markdown(b.id) is not None
    assert contenidos.leer_markdown(roto.id) is None
    assert contenidos.ruta_json(a.id).exists()
    assert convertidor.convertidos == ["/docs/a.pdf", "/docs/roto.pdf", "/docs/b.pdf"]
    # No toca el estado: el que fallo sigue indexado en Qdrant.
    assert {d.name: d.state for d in documentos_frescos()} == {
        "a.pdf": "indexado", "roto.pdf": "indexado", "b.pdf": "indexado",
    }


def test_no_toca_los_que_ya_tienen_contenido_ni_los_que_no_estan_indexados(
    db, monkeypatch, session_factory, converter
):
    convertidor = preparar(monkeypatch, session_factory, converter)
    con = indexado(db, "/docs/con.pdf")
    contenidos.ruta_markdown(con.id).write_text("ya estaba", encoding="utf-8")
    document_crud.crear_documento_encolado(
        db, origen="/docs/cola.pdf", nombre="cola.pdf", tipo="pdf", tamano=1, job_id="j",
    )
    error = document_crud.crear_documento(db, "/docs/error.pdf", "error.pdf", "pdf", 1)
    document_crud.marcar_error(db, error, "fallo")

    assert generar.main() == 0

    assert convertidor.convertidos == []
    assert contenidos.leer_markdown(con.id) == "ya estaba"
