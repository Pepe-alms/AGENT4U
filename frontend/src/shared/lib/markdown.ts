import DOMPurify from 'dompurify';
import { marked } from 'marked';

import type { Fuente } from '@/shared/api/types';

marked.use({
  gfm: true,
  // Un salto de linea suelto se respeta: los modelos escriben asi y, sin
  // esto, media respuesta se ve como un parrafo corrido.
  breaks: true,
});

/**
 * Lista blanca estricta. Lo que no este aqui desaparece.
 *
 * `img` se deja fuera a proposito: una respuesta del modelo con una imagen
 * remota es una peticion a un servidor de terceros desde la pagina del
 * usuario, y para un RAG sobre documentos propios no aporta nada.
 */
const ETIQUETAS = [
  'p',
  'br',
  'hr',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
];

const ATRIBUTOS = [
  'href',
  'title',
  'lang',
  'class',
  'start',
  'align',
  'colspan',
  'rowspan',
];

/**
 * Convierte el markdown del modelo en HTML seguro.
 *
 * El orden importa: primero se parsea y DESPUES se sanea. Lo que sale de aqui
 * es lo unico que puede entrar en `dangerouslySetInnerHTML`. El texto viene de
 * un LLM, que a su vez ha leido documentos que alguien subio: tratarlo como
 * HTML de confianza seria una via de XSS directa.
 */
export function markdownAHtml(texto: string, fuentes: Fuente[] = []): string {
  const crudo = marked.parse(texto, { async: false });

  const limpio = DOMPurify.sanitize(crudo, {
    ALLOWED_TAGS: ETIQUETAS,
    ALLOWED_ATTR: ATRIBUTOS,
    // Sin `javascript:` ni `data:` en los href, aunque DOMPurify ya los filtra.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
  });

  return rematar(limpio, fuentes);
}

/**
 * Retoques sobre HTML **ya saneado**: enlaces que no secuestran la pestaña y
 * un boton de copiar por bloque de codigo.
 *
 * El boton se anade aqui, despues de sanear, para que sea marcado nuestro y no
 * algo que el modelo pueda falsificar dentro de su respuesta.
 */
function rematar(html: string, fuentes: Fuente[]): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const enlace of doc.querySelectorAll('a[href]')) {
    enlace.setAttribute('target', '_blank');
    // noopener evita que la pestana abierta pueda tocar `window.opener`.
    enlace.setAttribute('rel', 'noopener noreferrer');
  }

  for (const bloque of doc.querySelectorAll('pre')) {
    const boton = doc.createElement('button');
    boton.type = 'button';
    boton.className = 'copiar-codigo';
    boton.textContent = 'Copiar';
    // Lo lee el manejador por delegacion para saber que bloque copiar.
    boton.setAttribute('data-copiar-codigo', '');
    bloque.insertBefore(boton, bloque.firstChild);
  }

  marcarCitas(doc, fuentes);

  return doc.body.innerHTML;
}

/** Un `[3]` suelto en el texto, con el numero capturado aparte. */
const CITA = /\[(\d{1,2})\]/g;

/**
 * Convierte los `[n]` del texto en botones que llevan a su fuente.
 *
 * Trabaja sobre los **nodos de texto** del documento ya saneado, nunca sobre la
 * cadena de HTML. Los botones se crean con `createElement` y `textContent`, asi
 * que no hay forma de que el modelo cuele marcado: lo unico que controla es el
 * numero, y solo se acepta si existe una fuente con ese indice.
 */
function marcarCitas(doc: Document, fuentes: Fuente[]): void {
  const totalFuentes = fuentes.length;
  if (totalFuentes === 0) return;

  const paseador = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const candidatos: Text[] = [];

  for (let nodo = paseador.nextNode(); nodo; nodo = paseador.nextNode()) {
    const texto = nodo as Text;
    // Dentro de codigo un `[1]` es codigo, no una cita. Y dentro de un enlace
    // un boton anidado seria HTML invalido.
    if (texto.parentElement?.closest('pre, code, a')) continue;
    if (CITA.test(texto.data)) candidatos.push(texto);
    CITA.lastIndex = 0;
  }

  for (const texto of candidatos) {
    const trozos = doc.createDocumentFragment();
    let ultimo = 0;

    for (const coincidencia of texto.data.matchAll(CITA)) {
      const numero = Number(coincidencia[1]);
      // Un numero fuera de rango se deja tal cual: el modelo se ha inventado
      // una cita y es mejor que se note a que parezca pulsable y no lleve a nada.
      if (numero < 1 || numero > totalFuentes) continue;

      const inicio = coincidencia.index;
      trozos.append(texto.data.slice(ultimo, inicio));

      trozos.append(crearCita(doc, numero, fuentes[numero - 1]!));

      ultimo = inicio + coincidencia[0].length;
    }

    if (ultimo === 0) continue;
    trozos.append(texto.data.slice(ultimo));
    texto.replaceWith(trozos);
  }
}

/** Contador de ids del popover. Global al modulo: solo tiene que ser unico
 *  dentro del documento, y las respuestas conviven en la misma pagina. */
let secuencia = 0;

/**
 * Un marcador de cita con su vista previa.
 *
 * El popover es **CSS puro**, y eso no es una preferencia de estilo: si
 * enseñarlo dependiera de estado de React, pasar el raton por encima
 * re-renderizaria el componente, React reescribiria el HTML inyectado y el
 * nodo desapareceria entre el `mousedown` y el `click`. Es exactamente el fallo
 * que encontro la prueba de punta a punta de la iteracion 022. Sin estado, no
 * hay re-render, y el clic llega siempre.
 *
 * Todo el texto entra por `textContent`: el nombre del documento y el
 * fragmento vienen de ficheros que subio alguien, asi que son datos, no HTML.
 */
function crearCita(doc: Document, numero: number, fuente: Fuente): HTMLElement {
  const id = `cita-${secuencia++}`;

  const envoltorio = doc.createElement('span');
  envoltorio.className = 'cita-envoltorio';

  const boton = doc.createElement('button');
  boton.type = 'button';
  boton.className = 'cita';
  boton.textContent = String(numero);
  boton.setAttribute('data-cita', String(numero));
  boton.setAttribute('aria-label', `Ver la fuente ${numero}: ${fuente.nombre}`);
  boton.setAttribute('aria-describedby', id);

  const popover = doc.createElement('span');
  popover.className = 'cita-popover';
  popover.id = id;
  popover.setAttribute('role', 'tooltip');

  const titulo = doc.createElement('span');
  titulo.className = 'cita-popover-doc';
  titulo.textContent = fuente.nombre;
  popover.append(titulo);

  const partes = [
    fuente.headings.join(' › '),
    fuente.paginas.length ? `pág. ${fuente.paginas.join(', ')}` : '',
  ].filter(Boolean);

  if (partes.length) {
    const meta = doc.createElement('span');
    meta.className = 'cita-popover-meta';
    meta.textContent = partes.join(' · ');
    popover.append(meta);
  }

  if (fuente.texto) {
    const fragmento = doc.createElement('span');
    fragmento.className = 'cita-popover-texto';
    fragmento.textContent = fuente.texto;
    popover.append(fragmento);
  }

  envoltorio.append(boton, popover);
  return envoltorio;
}
