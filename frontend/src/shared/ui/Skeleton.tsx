type Props = {
  /** Cualquier medida CSS valida. Por defecto ocupa todo el ancho. */
  ancho?: string;
  alto?: string;
};

/**
 * Marcador de carga. Es decorativo: lo anuncia el contenedor con aria-busy,
 * no cada pieza, para no inundar al lector de pantalla.
 */
export function Skeleton({ ancho = '100%', alto = '1rem' }: Props) {
  return (
    <span
      // El brillo que recorre la pieza, no un parpadeo de opacidad: se lee
      // como "esto esta llegando" y no como "esto esta roto".
      className="block rounded-s bg-superficie-suave bg-[linear-gradient(100deg,transparent_30%,var(--superficie-hover)_50%,transparent_70%)] bg-[length:200%_100%] motion-safe:animate-[brillar_1.4s_ease-in-out_infinite]"
      style={{ inlineSize: ancho, blockSize: alto }}
      aria-hidden="true"
    />
  );
}
