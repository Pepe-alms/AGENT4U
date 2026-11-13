"""Deduplicacion de documentos al indexar (app/services/indexacion.py).

Nivel 2: mismo contenido en otro envoltorio. Nivel 3: casi igual, pendiente
de que el usuario decida, y las tres formas de resolverlo. El nivel 1 (mismos
bytes) se prueba en la capa HTTP, porque se rechaza antes de encolar
(tests/api/test_indexation.py).

El nivel 3 se prueba contra Qdrant en memoria: hace falta que los filtros por
hash_texto y el borrado por documento funcionen de verdad.
"""
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.db.crud import document as document_crud
from app.services import contenidos
from app.services.huellas import hash_texto_normalizado, normalizar_texto
from app.services.indexacion import indexar_documento

from tests.conftest import FakeDocumento, hacer_chunk, texto_largo


class ChunkerPorParrafos:
    """Un fragmento por parrafo del texto del documento. El FakeChunker comun
    devuelve los mismos fragmentos para cualquier documento, y aqui lo que
    importa es justo cuales comparten."""

    def chunk(self, dl_doc):
        return [hacer_chunk(texto_largo(p)) for p in dl_doc.export_to_text().split("\n\n") if p.strip()]

    def contextualize(self, chunk):
        return chunk.text


@pytest.fixture
def chunker():
    return ChunkerPorParrafos()


class DocumentoConTexto(FakeDocumento):
    """Un documento cuyo texto extraido es el que se le diga."""

    def __init__(self, origen: str, texto: str):
        super().__init__(origen)
        self.texto = texto

    def export_to_text(self) -> str:
        return self.texto

    def save_as_json(self, ruta) -> None:
        import json
        import pathlib

        pathlib.Path(ruta).write_text(json.dumps({"origen": self.origen, "texto": self.texto}))


class ConverterConTextos:
    """Cada ruta da el texto que se le asigna: dos ficheros distintos (un PDF y
    un DOCX) pueden dar el mismo contenido."""

    def __init__(self, textos: dict[str, str]):
        self.textos = textos

    def convert(self, file_path: str):
        return SimpleNamespace(document=DocumentoConTexto(file_path, self.textos[file_path]))


def crear(db, origen):
    return document_crud.crear_documento(db, origen, origen.rsplit("/", 1)[1], "pdf", 1).id


def indexar(doc_id, origen, converter, chunker, dense_embedder, sparse_embedder, qdrant, **extra):
    return indexar_documento(
        doc_id, file_path=origen, converter=converter, chunker=chunker,
        dense_embedder=dense_embedder, sparse_embedder=sparse_embedder, qdrant=qdrant, **extra,
    )


@pytest.fixture
def mismo_texto_en_dos_formatos():
    return ConverterConTextos({
        "/docs/contrato.pdf": "Contrato de servicios.\n\nCláusula primera: el precio.",
        # El mismo texto, como lo daria otro formato: otros saltos, otros
        # espacios, otra caja.
        "/docs/contrato.docx": "CONTRATO DE SERVICIOS.   Cláusula  primera:\tel precio.",
        "/docs/otro.pdf": "Acta de la reunión.\n\nAsistentes y orden del día.",
    })


# ---------------------------------------------------------------------------
# Normalizacion
# ---------------------------------------------------------------------------

def test_la_normalizacion_ignora_espacios_saltos_mayusculas_y_ligaduras():
    assert normalizar_texto("  Uno\n\ndos\tTRES  ") == "uno dos tres"
    # "ﬁ" es una ligadura que algunos PDF sacan como un solo caracter.
    assert normalizar_texto("ﬁnal") == normalizar_texto("FINAL")


def test_un_texto_distinto_da_otra_huella():
    a = hash_texto_normalizado(DocumentoConTexto("a", "El precio es 100 euros."))
    b = hash_texto_normalizado(DocumentoConTexto("b", "El precio es 200 euros."))
    assert a != b


# ---------------------------------------------------------------------------
# Nivel 2 al indexar
# ---------------------------------------------------------------------------

def test_el_mismo_contenido_en_otro_formato_queda_duplicado_sin_indexarse(
    db, qdrant, mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder,
    documentos_frescos,
):
    pdf = crear(db, "/docs/contrato.pdf")
    docx = crear(db, "/docs/contrato.docx")
    indexar(pdf, "/docs/contrato.pdf", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)
    puntos_del_original = len(qdrant.puntos)

    resultado = indexar(docx, "/docs/contrato.docx", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)

    assert resultado == 0
    filas = {d.id: d for d in documentos_frescos()}
    assert filas[docx].state == "duplicado"
    assert filas[docx].duplicado_de == pdf
    assert filas[docx].hash_texto_normalizado == filas[pdf].hash_texto_normalizado
    # Ni puntos en Qdrant ni contenido guardado.
    assert len(qdrant.puntos) == puntos_del_original
    assert contenidos.leer_markdown(docx) is None
    assert not contenidos.ruta_json(docx).exists()


def test_un_contenido_distinto_se_indexa_normal(
    db, qdrant, mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder,
    documentos_frescos,
):
    pdf = crear(db, "/docs/contrato.pdf")
    otro = crear(db, "/docs/otro.pdf")
    indexar(pdf, "/docs/contrato.pdf", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)

    indexar(otro, "/docs/otro.pdf", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)

    assert {d.id: d.state for d in documentos_frescos()}[otro] == "indexado"


def test_un_original_en_error_no_cuenta(
    db, qdrant, mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder,
    documentos_frescos,
):
    """Un documento en error no tiene nada en Qdrant: no es un original."""
    pdf = crear(db, "/docs/contrato.pdf")
    docx = crear(db, "/docs/contrato.docx")
    qdrant.fallar_upsert = True
    with pytest.raises(RuntimeError):
        indexar(pdf, "/docs/contrato.pdf", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)
    qdrant.fallar_upsert = False

    indexar(docx, "/docs/contrato.docx", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)

    assert {d.id: d.state for d in documentos_frescos()} == {pdf: "error", docx: "indexado"}


def test_sin_comprobar_duplicados_se_indexa_aunque_coincida(
    db, qdrant, mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder,
    documentos_frescos,
):
    pdf = crear(db, "/docs/contrato.pdf")
    docx = crear(db, "/docs/contrato.docx")
    indexar(pdf, "/docs/contrato.pdf", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant)

    indexar(docx, "/docs/contrato.docx", mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, qdrant,
            comprobar_duplicados=False)

    assert {d.id: d.state for d in documentos_frescos()}[docx] == "indexado"


# ---------------------------------------------------------------------------
# Nivel 3: casi igual, pendiente de decision
# ---------------------------------------------------------------------------

PARRAFOS = [f"Artículo {n}. Disposición número {n} del reglamento." for n in range(1, 11)]


@pytest.fixture
def qdrant_real(monkeypatch):
    from qdrant_client import QdrantClient

    monkeypatch.setattr(get_settings(), "dimension_densa", 4)
    cliente = QdrantClient(":memory:")
    yield cliente
    cliente.close()


@pytest.fixture
def versiones():
    """Un reglamento de 10 articulos, una version nueva con uno cambiado y dos
    añadidos, y otro documento que solo comparte un articulo."""
    nueva = PARRAFOS[:9] + ["Artículo 10. Texto reformado.", "Artículo 11. Nuevo.", "Artículo 12. Nuevo."]
    return ConverterConTextos({
        "/docs/reglamento-2025.pdf": "\n\n".join(PARRAFOS),
        "/docs/reglamento-2026.pdf": "\n\n".join(nueva),
        "/docs/circular.pdf": "\n\n".join([PARRAFOS[0], "Circular interna.", "Fechas.", "Firmas."]),
    })


def indexar_en(qdrant, converter, chunker, dense_embedder, sparse_embedder, db, origen, **extra):
    doc = crear(db, origen)
    indexar(doc, origen, converter, chunker, dense_embedder, sparse_embedder, qdrant, **extra)
    return doc


def puntos_de(qdrant, doc_id) -> int:
    from qdrant_client import models

    from app.rag.vectorization import COLLECTION_NAME
    return qdrant.count(
        collection_name=COLLECTION_NAME,
        count_filter=models.Filter(must=[models.FieldCondition(
            key="documento_id", match=models.MatchValue(value=doc_id))]),
    ).count


pytestmark = pytest.mark.filterwarnings("ignore:Payload indexes have no effect")


def test_una_version_nueva_queda_pendiente_con_los_porcentajes_en_los_dos_sentidos(
    db, qdrant_real, versiones, chunker, dense_embedder, sparse_embedder, documentos_frescos,
):
    antiguo = indexar_en(qdrant_real, versiones, chunker, dense_embedder, sparse_embedder, db, "/docs/reglamento-2025.pdf")

    nuevo = indexar_en(qdrant_real, versiones, chunker, dense_embedder, sparse_embedder, db, "/docs/reglamento-2026.pdf")

    fila = {d.id: d for d in documentos_frescos()}[nuevo]
    assert fila.state == "pendiente-decision"
    assert fila.parecido_a == antiguo
    # 9 articulos en comun: 9 de los 12 del nuevo, 9 de los 10 del antiguo.
    assert fila.pct_nuevo_en_antiguo == pytest.approx(9 / 12, abs=1e-4)
    assert fila.pct_antiguo_en_nuevo == pytest.approx(9 / 10, abs=1e-4)
    # No se ha indexado: ni un punto, ni contenido legible; si su JSON, para
    # resolver sin volver a convertir.
    assert puntos_de(qdrant_real, nuevo) == 0
    assert contenidos.leer_markdown(nuevo) is None
    assert contenidos.ruta_json(nuevo).exists()


def test_por_debajo_del_umbral_se_indexa_sin_preguntar(
    db, qdrant_real, versiones, chunker, dense_embedder, sparse_embedder, documentos_frescos,
):
    indexar_en(qdrant_real, versiones, chunker, dense_embedder, sparse_embedder, db, "/docs/reglamento-2025.pdf")

    # Comparte 1 de sus 4 parrafos (25 %) y 1 de los 10 del reglamento.
    circular = indexar_en(qdrant_real, versiones, chunker, dense_embedder, sparse_embedder, db, "/docs/circular.pdf")

    assert {d.id: d.state for d in documentos_frescos()}[circular] == "indexado"


def test_el_umbral_sale_de_settings(
    db, qdrant_real, versiones, chunker, dense_embedder, sparse_embedder, documentos_frescos, monkeypatch,
):
    monkeypatch.setattr(get_settings(), "umbral_casi_duplicado", 0.95)
    indexar_en(qdrant_real, versiones, chunker, dense_embedder, sparse_embedder, db, "/docs/reglamento-2025.pdf")

    nuevo = indexar_en(qdrant_real, versiones, chunker, dense_embedder, sparse_embedder, db, "/docs/reglamento-2026.pdf")

    assert {d.id: d.state for d in documentos_frescos()}[nuevo] == "indexado"


def test_un_solape_justo_en_el_umbral_tambien_pregunta(
    db, qdrant_real, mismo_texto_en_dos_formatos, chunker, dense_embedder, sparse_embedder, documentos_frescos,
):
    """Comparte uno de sus dos parrafos: 50 %, que es el umbral."""
    convertidor = ConverterConTextos({
        **mismo_texto_en_dos_formatos.textos,
        "/docs/otra-version.pdf": "Contrato de servicios.\n\nCláusula primera: otro precio.",
    })
    indexar_en(qdrant_real, convertidor, chunker, dense_embedder, sparse_embedder, db, "/docs/contrato.pdf")

    otra = indexar_en(qdrant_real, convertidor, chunker, dense_embedder, sparse_embedder, db, "/docs/otra-version.pdf")

    assert {d.id: d.state for d in documentos_frescos()}[otra] == "pendiente-decision"


# ---------------------------------------------------------------------------
# Resolver: las tres acciones
# ---------------------------------------------------------------------------

class ConverterQueCuenta(ConverterConTextos):
    def __init__(self, textos):
        super().__init__(textos)
        self.convertidos: list[str] = []

    def convert(self, file_path):
        self.convertidos.append(file_path)
        return super().convert(file_path)


@pytest.fixture
def pendiente(db, qdrant_real, versiones, chunker, dense_embedder, sparse_embedder, monkeypatch):
    # El JSON guardado es el del documento falso, no un DoclingDocument: la ida
    # y vuelta real ya la prueba test_contenidos.py.
    import json

    def cargar(doc_id):
        ruta = contenidos.ruta_json(doc_id)
        if not ruta.exists():
            return None
        datos = json.loads(ruta.read_text())
        return DocumentoConTexto(datos["origen"], datos["texto"])

    monkeypatch.setattr(contenidos, "cargar_documento", cargar)
    convertidor = ConverterQueCuenta(versiones.textos)
    antiguo = indexar_en(qdrant_real, convertidor, chunker, dense_embedder, sparse_embedder, db, "/docs/reglamento-2025.pdf")
    nuevo = indexar_en(qdrant_real, convertidor, chunker, dense_embedder, sparse_embedder, db, "/docs/reglamento-2026.pdf")
    convertidor.convertidos.clear()
    return SimpleNamespace(antiguo=antiguo, nuevo=nuevo, convertidor=convertidor)


async def resolver_y_ejecutar(db, qdrant, pendiente, accion, chunker, dense_embedder, sparse_embedder):
    """Resuelve como lo haria la API y ejecuta el trabajo encolado como lo
    haria el worker."""
    from app.services import document_service
    from app.services.cola_port import ColaEnMemoria
    from app.worker.jobs import indexar_job

    cola = ColaEnMemoria()
    resultado = await document_service.resolver_pendiente(db, qdrant, cola, pendiente.nuevo, accion)
    for trabajo in cola.trabajos:
        ctx = {"converter": pendiente.convertidor, "chunker": chunker, "dense_embedder": dense_embedder,
               "sparse_embedder": sparse_embedder, "qdrant": qdrant}
        await indexar_job(ctx, trabajo["job_id"], trabajo["file_path"], trabajo["type"], trabajo["size"],
                          resolucion=trabajo["resolucion"])
    return resultado


async def test_reemplazar_borra_el_antiguo_e_indexa_el_nuevo_sin_volver_a_convertir(
    db, qdrant_real, pendiente, chunker, dense_embedder, sparse_embedder, documentos_frescos,
):
    resultado = await resolver_y_ejecutar(db, qdrant_real, pendiente, "reemplazar", chunker, dense_embedder, sparse_embedder)

    assert resultado["status"] == "en-cola"
    assert resultado["reemplazado"] == pendiente.antiguo
    filas = {d.id: d for d in documentos_frescos()}
    assert pendiente.antiguo not in filas
    assert filas[pendiente.nuevo].state == "indexado"
    assert filas[pendiente.nuevo].parecido_a is None
    assert puntos_de(qdrant_real, pendiente.antiguo) == 0
    assert puntos_de(qdrant_real, pendiente.nuevo) == 12
    assert contenidos.leer_markdown(pendiente.nuevo) is not None
    assert pendiente.convertidor.convertidos == []


async def test_conservar_ambos_indexa_el_nuevo_y_deja_el_antiguo(
    db, qdrant_real, pendiente, chunker, dense_embedder, sparse_embedder, documentos_frescos,
):
    resultado = await resolver_y_ejecutar(db, qdrant_real, pendiente, "conservar", chunker, dense_embedder, sparse_embedder)

    assert resultado["reemplazado"] is None
    filas = {d.id: d.state for d in documentos_frescos()}
    assert filas == {pendiente.antiguo: "indexado", pendiente.nuevo: "indexado"}
    assert puntos_de(qdrant_real, pendiente.antiguo) == 10
    assert puntos_de(qdrant_real, pendiente.nuevo) == 12
    # Ni se convierte otra vez, ni se vuelve a preguntar.
    assert pendiente.convertidor.convertidos == []


async def test_descartar_elimina_el_nuevo_y_no_toca_el_antiguo(
    db, qdrant_real, pendiente, chunker, dense_embedder, sparse_embedder, documentos_frescos,
):
    resultado = await resolver_y_ejecutar(db, qdrant_real, pendiente, "descartar", chunker, dense_embedder, sparse_embedder)

    assert resultado["status"] == "descartado"
    assert {d.id: d.state for d in documentos_frescos()} == {pendiente.antiguo: "indexado"}
    assert puntos_de(qdrant_real, pendiente.antiguo) == 10
    assert not contenidos.ruta_json(pendiente.nuevo).exists()


async def test_no_se_puede_resolver_un_documento_que_no_esta_pendiente(db, qdrant, pendiente):
    from app.core.exceptions import SinDecisionPendiente
    from app.services import document_service
    from app.services.cola_port import ColaEnMemoria

    with pytest.raises(SinDecisionPendiente):
        await document_service.resolver_pendiente(db, qdrant, ColaEnMemoria(), pendiente.antiguo, "conservar")
