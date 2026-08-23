from qdrant_client import models


def borrar_por_origen(qdrant, origen: str) -> bool:
    try:
        if not qdrant.collection_exists(collection_name="Test_1"):
            return False
        qdrant.delete(
            collection_name="Test_1",
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    should=[
                        models.FieldCondition(
                            key="origen",
                            match=models.MatchValue(value=origen),
                        ),
                        models.FieldCondition(
                            key="nombre",
                            match=models.MatchValue(value=origen),
                        ),
                    ],
                )
            ),
        )
        return True
    except Exception as e:
        print(f"Error al borrar por origen: {e}")
        return False