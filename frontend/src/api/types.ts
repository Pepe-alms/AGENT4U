
export type Fuente = {
    "nombre": string;
    "origen": string;
    "headings": string[];
    "paginas": number[];
}

export type Mensaje = {
    "id": number;
    "rol": "user" | "assistant";
    "contenido": string;
    "fuentes": Fuente[] | null;
    "creado_en": string;
}

export type ConversacionResumen = {
    "id": number;
    "titulo": string;
    "creada_en": string;
    "actualizada_en": string;
}

export type ConversacionDetalle = ConversacionResumen & {
    "mensajes": Mensaje[];
}