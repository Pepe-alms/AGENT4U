/**
 * Comprueba que en `dist/` no viaja nada que no deba publicarse.
 *
 * Existe porque el triaje de cierre de la v1.0 encontró `http://localhost:8000`
 * dentro del bundle de producción. Ni el typecheck ni el lint ni las pruebas lo
 * detectan: el código era correcto, lo que estaba mal era el valor que Vite
 * sustituyó al construir. Lo único que lo encuentra es mirar el resultado.
 *
 * Hacerlo a mano no sirve: funciona una vez y se olvida. Esto es la misma
 * revisión, ejecutable.
 *
 * CUIDADO con el orden: `npm run test:e2e` construye con `VITE_API_URL`
 * apuntando al servidor falso, así que deja un `dist/` que apunta a localhost.
 * Es correcto para esas pruebas y no se debe publicar. Por eso en `verificar`
 * los e2e van ANTES de la build final: así lo último que queda en `dist/` es la
 * build de producción, y además comprobada. Si se invirtiera el orden,
 * `verificar` terminaría en verde dejando un bundle que no se puede publicar.
 *
 * Uso: node herramientas/comprobar-bundle.mjs [carpeta]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const CARPETA = process.argv[2] ?? 'dist';

/** Solo lo que es texto. Las fuentes y las imágenes no se inspeccionan. */
const EXTENSIONES = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.svg']);

/**
 * Cada regla dice qué busca y, sobre todo, POR QUÉ el patrón es ese y no uno
 * más amplio. Los patrones amplios dan falsos positivos, y un falso positivo
 * repetido acaba con alguien desactivando la comprobación entera.
 */
const PROHIBIDO = [
  {
    patron: /localhost:\d+/,
    que: 'una URL local con puerto',
    porque:
      'el bundle apuntaría al equipo de quien lo construyó. Exige puerto a ' +
      'propósito: react-router lleva dentro `new URL("http://localhost")` sin ' +
      'puerto, que es legítimo y no debe dar falso positivo.',
  },
  {
    patron: /127\.0\.0\.1/,
    que: 'una dirección de bucle local',
    porque: 'mismo caso que localhost, escrito de otra forma.',
  },
  {
    patron: /x-sesion-prueba/,
    que: 'la cabecera que aísla las sesiones de prueba',
    porque: 'solo existe para separar los proyectos de Playwright entre sí.',
  },
  {
    patron: /servidor-falso/,
    que: 'el backend falso de las pruebas',
    porque: 'responde con datos inventados.',
  },
  {
    patron: /\bdebugger\b/,
    que: 'una sentencia debugger',
    porque: 'detiene el navegador de quien abra las herramientas de desarrollo.',
  },
  {
    patron: /console\.log\(/,
    que: 'una llamada a console.log',
    porque: 'hoy no hay ninguna; esto evita que se cuele la primera.',
  },
  {
    patron: /@testing-library|\bvitest\b|@playwright/,
    que: 'una herramienta de pruebas',
    porque: 'nada del arnés de pruebas debe acabar en lo que se publica.',
  },
];

function* ficheros(carpeta) {
  for (const entrada of readdirSync(carpeta)) {
    const ruta = join(carpeta, entrada);
    if (statSync(ruta).isDirectory()) yield* ficheros(ruta);
    else if (EXTENSIONES.has(extname(ruta))) yield ruta;
  }
}

let hallazgos = 0;
let revisados = 0;

try {
  statSync(CARPETA);
} catch {
  console.error(`No existe '${CARPETA}'. Ejecuta antes: npm run build`);
  process.exit(1);
}

for (const ruta of ficheros(CARPETA)) {
  revisados += 1;
  const contenido = readFileSync(ruta, 'utf8');

  for (const { patron, que, porque } of PROHIBIDO) {
    const encontrado = contenido.match(patron);
    if (!encontrado) continue;

    hallazgos += 1;
    console.error(`\n✗ ${ruta}`);
    console.error(`  Lleva ${que}: ${JSON.stringify(encontrado[0])}`);
    console.error(`  Por qué importa: ${porque}`);

    // El trozo alrededor, para no tener que ir a buscarlo a mano en un
    // fichero minificado de 200 kB.
    const desde = Math.max(0, encontrado.index - 60);
    console.error(`  Contexto: …${contenido.slice(desde, encontrado.index + 60)}…`);
  }
}

if (hallazgos > 0) {
  console.error(
    `\n${hallazgos} hallazgo(s) en ${revisados} ficheros de '${CARPETA}'. ` +
      `Esto NO se publica.`,
  );
  process.exit(1);
}

console.log(`✓ ${revisados} ficheros de '${CARPETA}' revisados, nada prohibido.`);
