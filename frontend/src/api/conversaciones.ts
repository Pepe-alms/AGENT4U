import type { ConversacionResumen } from "./types";

const BASE_URL = import.meta.env.VITE_API_URL;

const inicializador = {
    method: "GET",
    headers: {
    },
}
const solicitud = `${BASE_URL}/conversaciones`

export async function obtenerConversaciones(): Promise<ConversacionResumen[]> {
    const respuesta = await fetch(solicitud, inicializador);
    if (!respuesta.ok) {
        throw new Error(
            `No se pudieron cargar las conversaciones (${respuesta.status})`
        );
    }

    return await respuesta.json();
}

