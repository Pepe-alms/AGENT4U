import {useState} from 'react'

const API = import.meta.env.VITE_API_URL;

type Fuente = {
  nombre: string;
  origen?: string;
  headings?: string[];
  paginas: number[];
};

export default function App() {
    const [pregunta, setPregunta] = useState('');
    const [respuesta, setRespuesta] = useState('');
    const [fuentes, setFuentes] = useState<Fuente[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function consultar() {

        setRespuesta('');
        setFuentes([]);
        setError('');
        setLoading(true);
        
        try {
            const res = await fetch(`${API}/preguntar`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: pregunta }),
            });

            if (!res.ok || !res.body) {
                setError(`La consulta falló (${res.status})`);
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const eventos = buffer.split("\n\n");
                buffer = eventos.pop() ?? "";

                for (const evento of eventos) {
                    procesarEvento(evento);
                }
            }
            procesarEvento(buffer);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error de conexión');
        } finally {
            setLoading(false);
        }

        function procesarEvento(bloque: string) {
            const linea = bloque.trim();
            if (!linea.startsWith("data: ")) return;

            const evento = JSON.parse(linea.slice(6));

            if (evento.tipo === "fuentes") {
                setFuentes(evento.fuentes);
            }
            if (evento.tipo === "texto") {
                setRespuesta((r) => r + evento.texto);
            }
            if (evento.tipo === "error") {
                setError(evento.mensaje);
            }
        }
    }
    
    return (
        <div className="container">
            <h1>Agente de IA</h1>
            <textarea
                value={pregunta}
                onChange={(e) => setPregunta(e.target.value)}
                placeholder="Escribe tu pregunta aquí..."
            />
            <button onClick={consultar} disabled={loading}>
                {loading ? 'Consultando...' : 'Consultar'}
            </button>
            {error && <p className="error">{error}</p>}
            <div className="respuesta">
                <h2>Respuesta:</h2>
                <p>{respuesta}</p>
            </div>
            {fuentes.length > 0 && (
                <div className="fuentes">
                    <h2>Fuentes:</h2>
                    <ul>
                        {fuentes.map((fuente, index) => (
                            <li key={index}>
                                <strong>{fuente.nombre}</strong> - {fuente.origen || 'Sin origen'}
                                {fuente.headings && (
                                    <ul>
                                        {fuente.headings.map((heading, idx) => (
                                            <li key={idx}>{heading}</li>
                                        ))}
                                    </ul>
                                )}
                                <p>Páginas: {fuente.paginas.join(', ')}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}