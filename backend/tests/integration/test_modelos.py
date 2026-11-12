"""app/rag/modelos.py: cada libreria descarga en la carpeta de Settings.

Se sustituyen las clases de fastembed, el tokenizer y el descargador de
Docling por espias: aqui no se descarga nada, solo se mira donde se pediria.
"""
import sys
from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.rag import modelos


class Espia:
    llamadas: list[dict] = []

    def __init__(self, *args, **kwargs):
        Espia.llamadas.append(kwargs)


@pytest.fixture
def settings(tmp_path):
    Espia.llamadas = []
    return Settings(gemini_api_key="x", modelos_dir=str(tmp_path / "modelos"))


def test_fastembed_descarga_en_la_carpeta_de_settings(settings, monkeypatch):
    import fastembed
    import fastembed.rerank.cross_encoder as cross

    monkeypatch.setattr(fastembed, "TextEmbedding", Espia)
    monkeypatch.setattr(fastembed, "SparseTextEmbedding", Espia)
    monkeypatch.setattr(cross, "TextCrossEncoder", Espia)

    modelos.crear_embedder_denso(settings)
    modelos.crear_embedder_disperso(settings)
    modelos.crear_cross_encoder(settings)

    esperada = str(settings.ruta_modelos / "fastembed")
    assert [c["cache_dir"] for c in Espia.llamadas] == [esperada] * 3


def test_el_tokenizer_y_docling_descargan_en_la_carpeta_de_settings(settings, monkeypatch):
    import docling.utils.model_downloader as descargador
    import transformers

    pedidos = {}

    def tokenizer_falso(nombre, cache_dir=None):
        pedidos["tokenizer"] = cache_dir
        return SimpleNamespace()

    def descargar_falso(output_dir=None, **_kwargs):
        pedidos["docling"] = output_dir
        return output_dir

    monkeypatch.setattr(transformers.AutoTokenizer, "from_pretrained", tokenizer_falso)
    monkeypatch.setattr(descargador, "download_models", descargar_falso)
    monkeypatch.setitem(sys.modules, "docling_core.transforms.chunker.tokenizer.huggingface",
                        SimpleNamespace(HuggingFaceTokenizer=lambda **kw: kw))
    monkeypatch.setitem(sys.modules, "docling.chunking", SimpleNamespace(HybridChunker=lambda **kw: kw))

    modelos.crear_chunker(settings)
    convertidor = modelos.crear_converter(settings)

    assert pedidos["tokenizer"] == settings.ruta_modelos / "hf"
    assert pedidos["docling"] == settings.ruta_modelos / "docling"
    from docling.datamodel.base_models import InputFormat
    opciones = convertidor.format_to_options[InputFormat.PDF].pipeline_options
    assert opciones.artifacts_path == settings.ruta_modelos / "docling"


def test_la_carpeta_por_defecto_no_es_la_temporal_del_sistema():
    import tempfile

    ruta = Settings(gemini_api_key="x").ruta_modelos
    assert ruta.is_absolute()
    assert not str(ruta).startswith(tempfile.gettempdir())
