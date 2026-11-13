class DocumentoYaExiste(Exception):
    def __init__(self, origen: str):
        self.origen = origen
        super().__init__(f"El origen '{origen}' ya está indexado")


class DocumentoNoEncontrado(Exception):
    def __init__(self, documento_id: int):
        self.documento_id = documento_id
        super().__init__(f"No existe ningun documento con id {documento_id}.")


class SinDecisionPendiente(Exception):
    """Se pidio resolver un documento que no esta pendiente de decision."""

    def __init__(self, documento_id: int, estado: str):
        self.documento_id = documento_id
        self.estado = estado
        super().__init__(
            f"El documento {documento_id} no esta pendiente de decision (esta '{estado}')."
        )


class SinContenidoGuardado(Exception):
    """El documento existe pero no hay contenido que leer.

    No es lo mismo que no exista: el cliente puede explicarlo (indexado antes
    de que se guardara el contenido, aun en cola, fallo al indexar) en vez de
    dar un error generico.
    """

    MOTIVOS = {
        "en-cola": "todavia esta en cola para indexarse",
        "indexando": "se esta indexando ahora mismo",
        "error": "su indexacion fallo",
        "duplicado": "tiene el mismo contenido que otro documento y no se indexo",
        "pendiente-decision": "se parece mucho a otro documento y espera a que decidas que hacer",
    }

    def __init__(self, documento_id: int, estado: str):
        self.documento_id = documento_id
        self.estado = estado
        motivo = self.MOTIVOS.get(
            estado, "se indexo antes de que se guardara el contenido; "
                    "generalo con scripts/generar_contenido.py",
        )
        super().__init__(f"El documento {documento_id} no tiene contenido guardado: {motivo}.")


class ConversacionNoEncontrada(Exception):
    def __init__(self, conversacion_id: str):
        self.conversacion_id = conversacion_id
        super().__init__(f"Conversación con ID '{conversacion_id}' no encontrada")


class IndexacionSaturada(Exception):
    """No hay sitio para una indexacion mas, ni corriendo ni esperando.

    Se responde con 429 y no encolando indefinidamente a proposito: una
    peticion que espera es un hilo del threadpool ocupado y una conexion
    abierta. Decirle al cliente "ahora no, vuelve en un rato" es mas honesto
    que aceptarla y morir con todas a medias.
    """

    def __init__(self, en_curso: int, en_cola: int):
        self.en_curso = en_curso
        self.en_cola = en_cola
        super().__init__(
            f"Hay {en_curso} indexaciones en curso y {en_cola} esperando. "
            "Inténtalo de nuevo en unos minutos."
        )
