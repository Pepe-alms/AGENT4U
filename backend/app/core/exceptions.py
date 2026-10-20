class DocumentoYaExiste(Exception):
    def __init__(self, origen: str):
        self.origen = origen
        super().__init__(f"El origen '{origen}' ya está indexado")


class FalloIngesta(Exception):
    def __init__(self, origen: str, causa: str):
        self.origen = origen
        self.causa = causa
        super().__init__(f"Fallo al ingerir '{origen}': {causa}")

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
