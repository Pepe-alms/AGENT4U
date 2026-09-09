import {useState} from 'react'

const API = import.meta.env.VITE_API_URL;

type Fuente = {
  nombre: string;
  origen?: string;
  headings?: string[];
  pages: number[];
};

export default function App() {
    const [pregunta, setPregunta] = useState('');
    const [respuesta, setRespuesta] = useState('');
    const [fuentes, setFuentes] = useState<Fuente[]>([]);
    const [loading, setLoading] = useState(false);

    async function consultar() {

        setRespuesta('');
        setFuentes([]);
        setLoading(true);
        
        const res = await fetch(`${API}/consultar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ pregunta }),
        });

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let chunk = "";

        while (true) {
            const { done, value } = await reader!.read();
            if (done) break;

            chunk = decoder.decode(value, { stream: true });
            const data = chunk.split("\n\n")
            chunk = data.pop() || "";

            for (const d in data ){
                if (!d.startsWith("data: ")) continue;
                const evento = JSON.parse(d.slice(6));
                
                if (evento.type === "fuentes") {
                    setFuentes(evento.fuentes);}
                if (evento.type === "texto") {
                    setRespuesta((r) => r + evento.texto);
                }
            }
        }
        setLoading(false);
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
                                    <   ul>
                                        {fuente.headings.map((heading, idx) => (
                                            <li key={idx}>{heading}</li>
                                        ))}
                                    </ul>
                                )}
                                <p>Páginas: {fuente.pages.join(', ')}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}