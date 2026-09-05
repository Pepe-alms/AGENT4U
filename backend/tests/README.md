# Tests

La suite automatica esta separada por tipo de prueba, y dentro de cada tipo
los ficheros hacen espejo del modulo que cubren.

```
tests/
  conftest.py        fixtures y dobles compartidos (SQLite en memoria, Qdrant,
                     LLM, docling, grafo)
  unit/              funciones puras, sin dobles
    test_prompt.py         -> app/rag/prompt.py
    test_grafo_nodes.py    -> app/rag/grafo/grafo_nodes.py
  integration/       servicios contra SQLite en memoria y dobles
    test_indexation_service.py -> app/services/indexation_service.py
    test_query_service.py      -> app/services/query_service.py
    test_document_service.py   -> app/services/document_service.py
  api/               endpoints con el TestClient de FastAPI
    conftest.py                fixture del cliente
    test_indexation.py    -> app/api/routers/indexation.py
    test_documents.py     -> app/api/routers/documents.py
    test_conversations.py -> app/api/routers/conversations.py
    test_query.py         -> app/api/routers/query.py
  evaluation/        material manual de evaluacion (NO es pytest)
  data/              corpus de documentos para evaluacion
  results/           reportes generados por las evaluaciones
```

## Ejecutar

```bash
uv run pytest                    # toda la suite automatica
uv run pytest tests/unit         # solo un nivel
uv run pytest -k conversacion    # por nombre
```

No hace falta red, ni Qdrant levantado, ni claves de API: todo lo externo esta
sustituido por dobles y la base de datos es SQLite en memoria. La suite no
escribe en `agent4u.db`.

## evaluation/

Scripts manuales que sí llaman al LLM y a Qdrant reales, junto con los sets de
preguntas usados para medir la calidad de las respuestas. Pytest no los
recolecta (ver `python_files` en `pyproject.toml`); se lanzan a mano:

```bash
uv run python tests/evaluation/index_hard_docs.py
```
