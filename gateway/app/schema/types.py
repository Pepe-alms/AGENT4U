import strawberry


@strawberry.type
class Ajustes:
    modelos: list[str]
    max_fragmentos_defecto: int
    max_fragmentos_tope: int
    max_indexaciones_en_vuelo: int
