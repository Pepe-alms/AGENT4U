import { describe, expect, it } from 'vitest';

import { markdownAHtml } from '@/shared/lib/markdown';

/**
 * El visor pinta el Markdown de documentos que subio cualquiera. Estos casos
 * son los que un documento hostil podria traer: si alguno pasa, es XSS.
 */
describe('markdownAHtml sanea lo que viene de documentos de terceros', () => {
  it('quita scripts, manejadores de eventos e iframes', () => {
    const html = markdownAHtml(
      'Hola <script>alert(1)</script>\n\n<div onclick="alert(2)">x</div>\n\n<iframe src="https://mal.example"></iframe>',
    );
    expect(html).not.toMatch(/<script|onclick|<iframe|alert\(/i);
  });

  it('no deja enlaces javascript: ni data:', () => {
    const html = markdownAHtml('[a](javascript:alert(1)) [b](data:text/html,hola)');
    expect(html).not.toMatch(/javascript:|data:/i);
  });

  it('no carga imágenes remotas, ni en Markdown ni en HTML', () => {
    const html = markdownAHtml(
      '![x](https://mal.example/rastreo.png) <img src=x onerror=alert(1)>',
    );
    expect(html).not.toMatch(/<img|onerror/i);
  });

  it('no deja comentarios HTML, como los marcadores de imagen de Docling', () => {
    expect(markdownAHtml('Antes\n\n<!-- image -->\n\nDespués')).not.toContain('<!--');
  });

  it('conserva la estructura legítima: títulos, tablas y enlaces seguros', () => {
    const html = markdownAHtml(
      '## Título\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[web](https://ejemplo.com)',
    );
    expect(html).toContain('<h2>Título</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
