/**
 * Region de anuncios para lectores de pantalla.
 *
 * Existe **siempre**, vacia, y solo cambia su texto. Si se montase al tener
 * algo que decir, el lector no la tendria vigilada en el momento del cambio y
 * no leeria nada: `aria-live` solo anuncia lo que cambia dentro de una region
 * que ya estaba ahi.
 *
 * `polite` y no `assertive` a proposito: lo que se anuncia aqui son
 * confirmaciones, no emergencias, y `assertive` interrumpe lo que el usuario
 * este escuchando.
 */
export function Anuncios({ mensaje }: { mensaje: string }) {
  return (
    <div className="solo-lectores" role="status" aria-live="polite" aria-atomic="true">
      {mensaje}
    </div>
  );
}
