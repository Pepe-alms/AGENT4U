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