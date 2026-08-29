# Cache en aplicaciones

Una cache guarda temporalmente resultados costosos para reducir latencia y carga sobre la fuente original. Es especialmente util cuando los datos se consultan muchas veces y cambian con menos frecuencia que las lecturas. La cache no debe ser la unica fuente de verdad de informacion importante.

## Expiracion e invalidacion

El tiempo de vida debe reflejar la frecuencia de cambio y el impacto de servir datos antiguos. La invalidacion explicita permite retirar una entrada cuando se modifica el origen, mientras que la expiracion automatica evita conservarla indefinidamente. La eleccion debe documentarse por tipo de dato.

## Claves y concurrencia

Las claves deben incluir todos los parametros que cambian el resultado y una version cuando sea necesario. Ante una ausencia simultanea, muchos procesos pueden intentar recalcular el mismo valor; un bloqueo breve o la agrupacion de solicitudes ayuda a evitar ese efecto de estampida.

## Observacion y seguridad

Se deben medir aciertos, fallos, latencia, tamano y evicciones. Los valores almacenados pueden contener informacion sensible, por lo que deben aplicarse controles de acceso y, si procede, cifrado. Nunca se deben usar datos de usuario como parte de una clave sin validar su formato y alcance.