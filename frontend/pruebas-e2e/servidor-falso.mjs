/**
 * Backend de mentira para las pruebas de punta a punta.
 *
 * Vive en el repo, no en un directorio temporal, para que `npm run test:e2e`
 * funcione en cualquier máquina sin preparar nada. Reproduce el contrato real
 * de Agent4U, incluidas sus rarezas: GET /documentos responde 404 cuando no hay
 * ninguno, y POST /preguntar devuelve SSE, no JSON.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

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
    estado = {
      documentos: [],
      conversaciones: [],
      trabajos: new Map(),
      siguienteId: 1000,
    };
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

/** Como responderJson, pero con el envoltorio {data, errors} de GraphQL. */
function responderGraphQL(res, datos, errores) {
  responderJson(res, 200, errores ? { data: null, errors: errores } : { data: datos });
}

/**
 * Doble de POST /graphql del gateway real. No parsea GraphQL de verdad: el
 * campo pedido se identifica con el nombre que sigue a la primera `{` de la
 * query, que es justo donde cae tanto `{ ajustes { ... } }` como
 * `query($id: Int!) { conversacion(id: $id) { ... } }`.
 */
async function manejarGraphQL(req, res, sesion) {
  const { documentos, conversaciones } = sesion;
  const cuerpo = JSON.parse((await leerCuerpo(req)).toString() || '{}');
  const { query = '', variables = {} } = cuerpo;
  const campo = /\{\s*([a-zA-Z_]+)/.exec(query)?.[1];

  switch (campo) {
    case 'ajustes':
      return responderGraphQL(res, {
        ajustes: {
          modelos: ['gemini/gemini-flash-lite-latest'],
          max_fragmentos_defecto: 10,
          max_fragmentos_tope: 20,
          // El mismo techo que el backend real por defecto: 1 corriendo + 4
          // en cola. La interfaz lo usa para no dejar adjuntar un sexto
          // fichero.
          max_indexaciones_en_vuelo: 5,
        },
      });

    case 'documentos':
      return responderGraphQL(res, { documentos });

    case 'trabajo':
      return responderGraphQL(res, {
        trabajo: sesion.trabajos.get(variables.jobId) ?? null,
      });

    case 'conversaciones':
      return responderGraphQL(res, {
        conversaciones: conversaciones.map(({ mensajes: _mensajes, ...resto }) => resto),
      });

    case 'conversacion': {
      const conv = conversaciones.find((c) => c.id === variables.id);
      return responderGraphQL(res, {
        conversacion: conv ? { ...conv, mensajes: conv.mensajes ?? [] } : null,
      });
    }

    case 'salud':
      return responderGraphQL(res, {
        salud: {
          backend: 'ok',
          qdrant: {
            status: 'ok',
            coleccion: 'Agent4U',
            existe: documentos.length > 0,
            detalle: null,
          },
        },
      });

    case 'indexar': {
      const ruta = variables.filePath;
      if (documentos.some((d) => d.origin === ruta)) {
        return responderGraphQL(res, null, [
          { message: `El documento ${ruta} ya existe.`, extensions: { status: 409 } },
        ]);
      }
      const jobId = randomUUID();
      const nombre = ruta.split('/').pop() ?? ruta;
      documentos.push({
        id: documentos.length + 1,
        origin: ruta,
        name: nombre,
        type: variables.type,
        size: null,
        created_at: new Date().toISOString(),
        state: 'indexado',
        num_chunks: 12,
        error_message: null,
      });
      sesion.trabajos.set(jobId, {
        job_id: jobId,
        status: 'indexado',
        origin: ruta,
        name: nombre,
        num_chunks: 12,
        error_message: null,
      });
      return responderGraphQL(res, { indexar: { job_id: jobId, status: 'en-cola' } });
    }

    case 'indexar_url': {
      const url = variables.url;
      if (documentos.some((d) => d.origin === url)) {
        return responderGraphQL(res, null, [
          { message: `El documento ${url} ya existe.`, extensions: { status: 409 } },
        ]);
      }
      const jobId = randomUUID();
      documentos.push({
        id: documentos.length + 1,
        origin: url,
        name: url,
        type: 'url',
        size: null,
        created_at: new Date().toISOString(),
        state: 'indexado',
        num_chunks: 12,
        error_message: null,
      });
      sesion.trabajos.set(jobId, {
        job_id: jobId,
        status: 'indexado',
        origin: url,
        name: url,
        num_chunks: 12,
        error_message: null,
      });
      return responderGraphQL(res, { indexar_url: { job_id: jobId, status: 'en-cola' } });
    }

    case 'eliminar_documento': {
      const indice = documentos.findIndex((d) => d.name === variables.nombre);
      if (indice === -1) {
        return responderGraphQL(res, null, [
          { message: 'Documento no encontrado.', extensions: { status: 404 } },
        ]);
      }
      documentos.splice(indice, 1);
      return responderGraphQL(res, {
        eliminar_documento: { status: 'eliminado', documento: variables.nombre },
      });
    }

    case 'eliminar_conversacion': {
      const indice = conversaciones.findIndex((c) => c.id === variables.id);
      if (indice === -1) {
        return responderGraphQL(res, null, [
          { message: 'Conversación no encontrada', extensions: { status: 404 } },
        ]);
      }
      conversaciones.splice(indice, 1);
      return responderGraphQL(res, {
        eliminar_conversacion: { status: 'eliminada', id: variables.id },
      });
    }

    case 'renombrar_conversacion': {
      const conv = conversaciones.find((c) => c.id === variables.id);
      if (!conv) {
        return responderGraphQL(res, null, [
          { message: 'Conversación no encontrada', extensions: { status: 404 } },
        ]);
      }
      conv.titulo = variables.titulo;
      return responderGraphQL(res, {
        renombrar_conversacion: {
          id: conv.id,
          titulo: conv.titulo,
          creada_en: conv.creada_en,
          actualizada_en: conv.actualizada_en,
        },
      });
    }

    default:
      return responderGraphQL(res, null, [
        { message: `Operación GraphQL no soportada: ${campo}` },
      ]);
  }
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

  // Sonda de arranque de Playwright (playwright.config.ts): tiene que seguir
  // siendo REST, porque se comprueba con un GET antes de que exista ningun
  // frontend que hable GraphQL.
  if (url === '/health') return responderJson(res, 200, { status: 'ok' });

  if (url === '/graphql' && method === 'POST') {
    return manejarGraphQL(req, res, sesion);
  }

  if (url === '/indexar-fichero' && method === 'POST') {
    const cuerpo = (await leerCuerpo(req)).toString('utf8', 0, 4000);
    const nombre = /filename="([^"]*)"/.exec(cuerpo)?.[1] ?? 'subido.pdf';
    const ruta = `/subidas/${nombre}`;
    if (documentos.some((d) => d.origin === ruta)) {
      return responderJson(res, 409, { detail: `El documento ${ruta} ya existe.` });
    }
    const jobId = randomUUID();
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
    sesion.trabajos.set(jobId, {
      job_id: jobId,
      status: 'indexado',
      origin: ruta,
      name: nombre,
      num_chunks: 12,
      error_message: null,
    });
    return responderJson(res, 202, { job_id: jobId, status: 'en-cola', ruta });
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
