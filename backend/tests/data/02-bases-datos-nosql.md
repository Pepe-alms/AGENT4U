# Bases de datos NoSQL: tipos y casos de uso

El término NoSQL agrupa sistemas de gestión de datos que no siguen el modelo relacional clásico. Se popularizó a partir de 2009, aunque muchos de los sistemas que engloba son anteriores. La motivación principal fue la escalabilidad horizontal y la flexibilidad de esquema en aplicaciones web de gran volumen.

## Bases de datos clave-valor

Almacenan pares formados por una clave única y un valor opaco para el motor. Son las más simples y las más rápidas para acceso directo por clave. Redis y Amazon DynamoDB son los ejemplos más extendidos. Su limitación es que no permiten consultar por el contenido del valor sin recurrir a índices secundarios.

## Bases de datos documentales

Guardan documentos semiestructurados, habitualmente en JSON o BSON, y permiten consultar por los campos internos del documento. MongoDB y CouchDB pertenecen a esta categoría. Cada documento puede tener campos distintos, lo que elimina la necesidad de migraciones de esquema al añadir atributos.

## Bases de datos de familia de columnas

Organizan los datos por columnas en lugar de por filas, lo que las hace eficientes para agregaciones sobre grandes volúmenes. Apache Cassandra y HBase son los representantes habituales. Cassandra nació en Facebook en 2008 y se donó a la Apache Software Foundation en 2009.

## Bases de datos de grafos

Modelan entidades como nodos y relaciones como aristas, ambas con propiedades. Son la opción natural cuando las consultas recorren relaciones de profundidad variable, como en redes sociales o detección de fraude. Neo4j es el motor más conocido y utiliza el lenguaje de consulta Cypher.

## Bases de datos vectoriales

Constituyen una categoría más reciente, orientada a almacenar representaciones vectoriales de alta dimensionalidad y recuperar los vectores más cercanos a uno dado. Se apoyan en índices de vecino más cercano aproximado, típicamente el algoritmo HNSW. Qdrant, Milvus y Weaviate son ejemplos representativos.

## El teorema CAP

Formulado por Eric Brewer en el año 2000 y demostrado formalmente por Gilbert y Lynch en 2002, el teorema CAP establece que un sistema distribuido no puede garantizar simultáneamente las tres propiedades siguientes: consistencia, disponibilidad y tolerancia a particiones de red. Como las particiones de red son inevitables en un sistema distribuido real, en la práctica la elección se produce entre consistencia y disponibilidad.

| Sistema | Modelo | Prioriza |
|---|---|---|
| Redis | Clave-valor | Disponibilidad |
| MongoDB | Documental | Consistencia |
| Cassandra | Familia de columnas | Disponibilidad |
| Neo4j | Grafo | Consistencia |

## Consistencia eventual

Muchos sistemas NoSQL adoptan un modelo de consistencia eventual: tras una escritura, las réplicas convergen al mismo valor pasado un tiempo, pero una lectura inmediata puede devolver un dato obsoleto. Este modelo es aceptable en escenarios como un contador de visitas y claramente inaceptable en un saldo bancario. La elección del modelo de consistencia es una decisión de negocio antes que técnica.
