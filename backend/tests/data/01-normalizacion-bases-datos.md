# Normalización en bases de datos relacionales

La normalización es el proceso de estructurar las tablas de una base de datos relacional para reducir la redundancia y evitar anomalías de inserción, actualización y borrado. El modelo relacional fue propuesto por Edgar F. Codd en 1970 en el artículo "A Relational Model of Data for Large Shared Data Banks", publicado en Communications of the ACM.

## Primera forma normal (1FN)

Una tabla está en primera forma normal cuando todos sus atributos son atómicos, es decir, cada celda contiene un único valor indivisible. No se admiten grupos repetitivos ni listas dentro de una columna. Una tabla de clientes que guarde varios teléfonos separados por comas en un mismo campo incumple la 1FN.

## Segunda forma normal (2FN)

Una tabla está en segunda forma normal si cumple la 1FN y además todos los atributos no clave dependen funcionalmente de la clave primaria completa, no de una parte de ella. Esta forma solo aporta restricciones adicionales cuando la clave primaria es compuesta. El caso típico de incumplimiento es una tabla de líneas de pedido con clave compuesta por número de pedido y código de producto, en la que se almacena el nombre del producto: ese nombre depende únicamente del código de producto, no de la clave completa.

## Tercera forma normal (3FN)

Una tabla está en tercera forma normal si cumple la 2FN y ningún atributo no clave depende transitivamente de la clave primaria. Dicho de otro modo, no debe haber atributos que dependan de otros atributos no clave. Si una tabla de empleados guarda el código de departamento y también el nombre del departamento, el nombre depende del código, no del empleado, y se produce una dependencia transitiva.

## Forma normal de Boyce-Codd (BCNF)

La BCNF es una versión más estricta de la 3FN, formulada por Raymond Boyce y Edgar Codd en 1974. Exige que para toda dependencia funcional no trivial, el determinante sea una superclave. Existen tablas en 3FN que no cumplen la BCNF, y esto ocurre cuando hay varias claves candidatas solapadas.

## Cuarta y quinta forma normal

La cuarta forma normal (4FN) elimina las dependencias multivaluadas: se produce cuando dos atributos independientes entre sí se almacenan en la misma tabla generando combinaciones redundantes. La quinta forma normal (5FN), también llamada forma normal de proyección-unión, trata las dependencias de unión y garantiza que una tabla no pueda descomponerse en tablas más pequeñas sin pérdida de información.

## Resumen comparativo

| Forma normal | Año de formulación | Elimina |
|---|---|---|
| 1FN | 1970 | Grupos repetitivos y valores no atómicos |
| 2FN | 1971 | Dependencias parciales de la clave |
| 3FN | 1971 | Dependencias transitivas |
| BCNF | 1974 | Determinantes que no son superclave |
| 4FN | 1977 | Dependencias multivaluadas |
| 5FN | 1979 | Dependencias de unión |

## Desnormalización controlada

En sistemas analíticos con alto volumen de lectura es habitual desnormalizar de forma deliberada, duplicando datos para evitar uniones costosas. Los esquemas en estrella de los almacenes de datos son el ejemplo canónico: la tabla de hechos se rodea de tablas de dimensión desnormalizadas. La desnormalización es una decisión de rendimiento consciente, no un descuido de diseño, y debe documentarse siempre junto a la estrategia de actualización de los datos duplicados.
