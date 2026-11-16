"""El unico camino para indexar un documento que ya tiene fila en la BD.

Lo usan el worker de ARQ, los scripts de evaluacion y el de reindexado. Antes
habia dos copias (el worker e `indexation_service`), y cada arreglo habia que
hacerlo dos veces.

**Es sincrono y tarda minutos**: quien lo llame desde una corrutina tiene que
pasarlo por un hilo (`asyncio.to_thread`), o bloquea el event loop.
"""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import DocumentoYaExiste
from app.db.crud import document as document_crud
from app.db.models.document import Document
from app.db.session import SessionLocal
from app.core.config import get_settings
from app.rag.vectorization import borrar_por_documento, embed_texts, normalize_text, solapes_por_documento
from app.services import contenidos
from app.services.huellas import hash_texto_normalizado


def registrar_documento(db: Session, origen: str, nombre: str, tipo: str,
                        tamano: int | None = None) -> int:
    """Crea la fila de un documento para indexarlo despues sin cola.

    Es lo que hacen los scripts de evaluacion; la API crea la suya con
    `crear_documento_encolado`. El origen es unico: si ya existe, lanza
    DocumentoYaExiste.
    """
    try:
        doc = document_crud.crear_documento(db, origen, nombre, tipo, tamano)
    except IntegrityError:
        db.rollback()
        raise DocumentoYaExiste(origen)
    return doc.id


def indexar_documento(doc_id: int, *, file_path: str, converter, chunker,
                      dense_embedder, sparse_embedder, qdrant,
                      desde_json: bool = False,
                      comprobar_duplicados: bool = True) -> int | None:
    """Convierte, trocea, vectoriza y sube a Qdrant el documento `doc_id`.

    Marca 'indexando' al empezar y 'indexado' o 'error' al terminar. Devuelve
    el numero de fragmentos, o None si la fila ya no existe (la borraron
    mientras esperaba). Si falla, borra lo que llegara a subir, marca el error
    y relanza la excepcion.

    Guarda tambien el contenido completo (app/services/contenidos.py), y solo
    lo deja en su sitio si la indexacion termina bien. Con `desde_json`, si hay
    un DoclingDocument guardado se usa ese en vez de convertir otra vez.

    Deduplicacion, nivel 2: tras convertir se calcula la huella del texto. Si
    otro documento ya tiene ese mismo contenido, este queda 'duplicado' y no
    se indexa (devuelve 0).

    Nivel 3: tras trocear y antes de vectorizar, si comparte demasiados
    fragmentos con un documento indexado (`Settings.umbral_casi_duplicado`),
    queda 'pendiente-decision' con su DoclingDocument guardado y no se indexa
    (devuelve 0) hasta que el usuario decida. Nunca se decide solo.

    `comprobar_duplicados=False` se salta los dos niveles: para reindexar lo
    que ya estaba, o cuando el usuario ya ha decidido conservarlo.

    Cada escritura de estado abre su propia sesion: esto corre en un hilo que
    puede durar mas que la peticion o el job que lo lanzo.
    """
    with SessionLocal() as sesion:
        doc = sesion.get(Document, doc_id)
        if doc is None:
            return None
        document_crud.marcar_indexando(sesion, doc)
        nombre = doc.name
        tipo = doc.type

    # Lo que hubiera de una indexacion anterior se va antes de subir lo nuevo.
    # Los ids son por (documento, posicion), asi que el upsert ya sobrescribe,
    # pero si el documento tiene ahora menos fragmentos sobrarian los del final.
    borrar_por_documento(qdrant, doc_id)

    try:
        documento = contenidos.cargar_documento(doc_id) if desde_json else None
        if documento is None:
            documento = converter.convert(file_path).document

        huella = hash_texto_normalizado(documento)
        original = _guardar_huella(doc_id, huella, comprobar_duplicados)
        if original is not None:
            contenidos.descartar(doc_id)
            return 0

        temporales = contenidos.guardar_temporales(doc_id, documento)
        chunks, records = normalize_text(
            documento=documento, chunker=chunker, file_path=file_path,
            name=nombre, type=tipo, documento_id=doc_id,
        )
        if comprobar_duplicados and _parecido_pendiente(doc_id, records, qdrant):
            contenidos.guardar_pendiente(doc_id, documento)
            return 0
        embed_texts(
            chunks=chunks, dense_embedder=dense_embedder,
            sparse_embedder=sparse_embedder, qdrant=qdrant, records=records,
        )
        contenidos.confirmar(doc_id, temporales)
    except Exception as e:
        borrar_por_documento(qdrant, doc_id)
        contenidos.descartar(doc_id)
        _marcar_estado_final(doc_id, mensaje=str(e))
        raise

    _marcar_estado_final(doc_id, num_chunks=len(chunks))
    return len(chunks)


def _guardar_huella(doc_id: int, huella: str, comprobar: bool) -> int | None:
    """Guarda la huella de texto y, si otro documento ya la tiene, marca este
    como duplicado. Devuelve el id del original, o None si no hay."""
    with SessionLocal() as sesion:
        doc = sesion.get(Document, doc_id)
        if doc is None:
            return None
        doc.hash_texto_normalizado = huella
        sesion.commit()
        if not comprobar:
            return None
        original = document_crud.con_mismo_texto(sesion, huella, salvo=doc_id)
        if original is None:
            return None
        document_crud.marcar_duplicado(sesion, doc, original.id)
        return original.id


def _parecido_pendiente(doc_id: int, records: list[dict], qdrant) -> bool:
    """Nivel 3. Si el documento se parece demasiado a uno indexado, lo deja
    pendiente de decision y devuelve True."""
    hashes = {r["hash_texto"] for r in records}
    solapes = solapes_por_documento(qdrant, hashes, salvo=doc_id)
    if not solapes:
        return False

    with SessionLocal() as sesion:
        # Solo cuentan los indexados: puede haber puntos de uno que se esta
        # indexando ahora mismo o que se acaba de borrar.
        validos = document_crud.ids_indexados(sesion, list(solapes))
        mejor = None
        for otro in validos:
            comunes, suyos = solapes[otro]
            nuevo_en_antiguo = comunes / len(hashes)
            antiguo_en_nuevo = comunes / suyos if suyos else 0.0
            clave = (max(nuevo_en_antiguo, antiguo_en_nuevo), -otro)
            if mejor is None or clave > mejor[0]:
                mejor = (clave, otro, nuevo_en_antiguo, antiguo_en_nuevo)

        if mejor is None or mejor[0][0] < get_settings().umbral_casi_duplicado:
            return False

        doc = sesion.get(Document, doc_id)
        if doc is None:
            return False
        _, otro, nuevo_en_antiguo, antiguo_en_nuevo = mejor
        document_crud.marcar_pendiente_decision(
            sesion, doc, otro, round(nuevo_en_antiguo, 4), round(antiguo_en_nuevo, 4),
        )
        return True


def _marcar_estado_final(doc_id: int, *, num_chunks: int | None = None,
                         mensaje: str | None = None) -> None:
    with SessionLocal() as sesion:
        doc = sesion.get(Document, doc_id)
        if doc is None:
            # Lo borraron mientras se indexaba. No hay nada que marcar.
            return
        if mensaje is None:
            document_crud.marcar_indexado(sesion, doc, num_chunks)
        else:
            document_crud.marcar_error(sesion, doc, mensaje)
