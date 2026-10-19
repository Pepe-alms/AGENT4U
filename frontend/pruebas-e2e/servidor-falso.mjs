/**
 * Backend de mentira para las pruebas de punta a punta.
 *
 * Vive en el repo, no en un directorio temporal, para que `npm run test:e2e`
 * funcione en cualquier máquina sin preparar nada. Reproduce el contrato real
 * de Agent4U, incluidas sus rarezas: GET /documentos responde 404 cuando no hay
 * ninguno, y POST /preguntar devuelve SSE, no JSON.
 */
import { createServer } from 'node:http';

const PUERTO = Number(process.argv[2] ?? 8099);

/*
 * El estado se PARTICIONA por sesion, y no es un lujo.
 *
 * Los dos proyectos de Playwright —Chrome e iPhone— corren a la vez contra
 * este mismo servidor. Con un unico estado compartido, el segundo en subir
 * `manual-cap.pdf` recibia un 409 "ya existe" y, peor, la prueba que empieza
 * comprobando "aun no hay nada indexado" veia el documento del otro proyecto.
 * Pasaba sola y fallaba en la tanda.
 *
 * Cada proyecto manda `x-sesion-prueba` con su nombre (ver
 * `extraHTTPHeaders` en playwright.config.ts) y se lleva su propio mundo.
 */
const sesiones = new Map();

function estadoDe(req) {
  const clave = req.headers['x-sesion-prueba'] ?? 'global';
  let estado = sesiones.get(clave);
  if (!estado) {
    estado = { documentos: [], conversaciones: [], siguienteId: 1000 };
    sesiones.set(clave, estado);
  }
  return estado;
}

const TROZOS = [
  '## El teorema CAP\n\n',
  'Un sistema distribuido **no puede** garantizar las tres a la vez [1].\n\n',
  '- Consistencia\n- Disponibilidad\n- Partición\n\n',
  '```python\nprint("hola")\n```\n',
];

const FUENTE = {
  nombre: 'manual-cap.pdf',
  origen: '/subidas/manual-cap.pdf',
  headings: ['Replicación', 'Teorema CAP'],
  paginas: [163, 164],
  texto:
    'El teorema CAP establece que un sistema distribuido no puede garantizar ' +
    'simultáneamente consistencia, disponibilidad y tolerancia a particiones. ' +
    'Ante una partición de red hay que elegir entre las dos primeras.',
  // Sin acotar y puede ser negativo, como el del reordenador real.
  score: 2.41,
  subconsulta: 'garantías del teorema CAP',
};

const FUENTE_SECUNDARIA = {
  nombre: 'notas-replicacion.md',
  origen: '/subidas/notas-replicacion.md',
  headings: ['Consistencia eventual'],
  paginas: [],
  texto:
    'En la práctica, la mayoría de los sistemas eligen AP y recuperan la ' +
    'consistencia más tarde, de forma eventual.',
  score: 0.87,
  subconsulta: 'consistencia eventual',
};

/* Los mismos nodos del grafo real, con tiempos del mismo orden de magnitud:
   el de buscar es el que de verdad se nota. */
const PASOS = [
  { nodo: 'reformular', ms: 3 },
  { nodo: 'multiconsulta', ms: 412, subconsultas: 2 },
  { nodo: 'buscar', ms: 806, fragmentos: 10 },
  { nodo: 'fusionar', ms: 2, fragmentos: 2 },
  { nodo: 'evaluar', ms: 1, score: 2.41, pobre: false },
  { nodo: 'construir', ms: 1 },
];

function responderJson(res, codigo, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(texto),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(texto);
}

function leerCuerpo(req) {
  return new Promise((resolver) => {
    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => resolver(Buffer.concat(trozos)));
  });
}

createServer(async (req, res) => {
  const { method, url } = req;
  const { documentos, conversaciones } = estadoDe(req);
  const sesion = estadoDe(req);

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Content-Length': 0,
    });
    return res.end();
  }

  if (url === '/health') return responderJson(res, 200, { status: 'ok' });
  if (url === '/health/qdrant') {
    return responderJson(res, 200, {
      status: 'ok',
      coleccion: 'Agent4U',
      existe: documentos.length > 0,
      detalle: null,
    });
  }
  if (url === '/ajustes') {
    return responderJson(res, 200, {
      modelos: ['gemini/gemini-flash-lite-latest'],
      max_fragmentos_defecto: 10,
      max_fragmentos_tope: 20,
    });
  }

  if (url?.startsWith('/documentos')) {
    // Igual que el backend real: 404 cuando la colección está vacía.
    if (documentos.length === 0)
      return responderJson(res, 404, { detail: 'No hay documentos.' });
    return responderJson(res, 200, { documentos });
  }

  if (url?.startsWith('/conversaciones')) {
    const partes = url.split('/');
    if (partes[2]) {
      const conv = conversaciones.find((c) => String(c.id) === partes[2]);
      if (!conv) return responderJson(res, 404, { detail: 'Conversación no encontrada' });
      return responderJson(res, 200, { ...conv, mensajes: conv.mensajes ?? [] });
    }
    // El listado no lleva mensajes, igual que el backend real: solo el
    // detalle de una conversación los trae.
    return responderJson(
      res,
      200,
      conversaciones.map(({ mensajes: _mensajes, ...resto }) => resto),
    );
  }

  if (url === '/indexar-fichero' && method === 'POST') {
    const cuerpo = (await leerCuerpo(req)).toString('utf8', 0, 4000);
    const nombre = /filename="([^"]*)"/.exec(cuerpo)?.[1] ?? 'subido.pdf';
    const ruta = `/subidas/${nombre}`;
    if (documentos.some((d) => d.origin === ruta)) {
      return responderJson(res, 409, { detail: `El documento ${ruta} ya existe.` });
    }
    documentos.push({
      id: documentos.length + 1,
      origin: ruta,
      name: nombre,
      type: 'pdf',
      size: 1024,
      created_at: new Date().toISOString(),
      state: 'indexado',
      num_chunks: 12,
      error_message: null,
    });
    return responderJson(res, 200, { status: 'indexado', num_chunks: 12, ruta });
  }

  if (url === '/preguntar' && method === 'POST') {
    const cuerpo = JSON.parse((await leerCuerpo(req)).toString() || '{}');
    const id = cuerpo.conversacion_id ?? sesion.siguienteId++;
    let conv = conversaciones.find((c) => c.id === id);
    if (!conv) {
      conv = {
        id,
        titulo: String(cuerpo.query ?? '').slice(0, 60),
        creada_en: new Date().toISOString(),
        actualizada_en: new Date().toISOString(),
        mensajes: [],
      };
      conversaciones.unshift(conv);
    }

    // El backend real persiste el turno completo, y de ahí vuelve el hilo al
    // recargar la página. Sin esto, la conversación volvería vacía.
    conv.mensajes.push({
      id: conv.mensajes.length + 1,
      rol: 'user',
      contenido: String(cuerpo.query ?? ''),
      fuentes: null,
      creado_en: new Date().toISOString(),
    });
    conv.mensajes.push({
      id: conv.mensajes.length + 1,
      rol: 'assistant',
      contenido: TROZOS.join(''),
      fuentes: [FUENTE],
      creado_en: new Date().toISOString(),
    });
    conv.actualizada_en = new Date().toISOString();

    // HTTP/1.0 sin Content-Length: el cuerpo acaba al cerrar el socket, que es
    // lo que entiende el navegador para un stream.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    const evento = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
    evento({ tipo: 'inicio', conversacion_id: id });
    // Antes de las fuentes, como el backend real: los pasos del grafo salen
    // mientras ocurren, que es lo que llena el hueco hasta el primer token.
    for (const paso of PASOS) evento({ tipo: 'paso', ...paso });
    evento({ tipo: 'fuentes', fuentes: [FUENTE, FUENTE_SECUNDARIA] });
    for (const trozo of TROZOS) evento({ tipo: 'texto', texto: trozo });
    evento({ tipo: 'fin' });
    return res.end();
  }

  responderJson(res, 404, { detail: 'Not Found' });
}).listen(PUERTO, () => {
  console.log(`servidor falso en http://localhost:${PUERTO}`);
});
