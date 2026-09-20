import { useState, useEffect } from 'react';
import { obtenerConversaciones } from "./api/conversaciones"

export default function App() {

    const [lista_conversaciones, setConversaciones] = useState([]);

    useEffect(() => {
        const lista_conversaciones = async () => {
            try{
                const conversaciones = await obtenerConversaciones();
                setConversaciones(conversaciones);
                console.log("Se ha cargado la lista de conversaciones:", conversaciones);
            } catch (error) {
                console.error("Error al cargar la lista de conversaciones:", error);
            }
        };
        lista_conversaciones();
    }, []);

    return (
        <div>
            <h1>Hello, World!</h1>
            <h2>Lista de conversaciones:</h2>
            <ul>
                {lista_conversaciones.map((conversacion) => (
                    <li key={conversacion.id}>
                        <strong>{conversacion.titulo}</strong> - Creada en: {conversacion.creada_en} - Actualizada en: {conversacion.actualizada_en}
                    </li>
                ))}
            </ul>
        </div>
    );
    }