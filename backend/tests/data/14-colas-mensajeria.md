# Colas de mensajeria

Una cola de mensajeria desacopla productores y consumidores mediante mensajes persistentes. El productor publica una tarea sin tener que esperar a que el consumidor la procese, lo que ayuda a absorber picos de carga y a limitar la dependencia temporal entre servicios.

## Entrega y confirmacion

En un sistema de entrega al menos una vez, un mensaje puede recibirse mas de una vez si el consumidor falla antes de confirmar su procesamiento. Por eso cada consumidor debe ser idempotente: repetir la misma operacion no debe producir un efecto incorrecto. La confirmacion solo debe enviarse despues de completar la tarea.

## Reintentos y mensajes fallidos

Los reintentos deben tener un limite y un retraso progresivo para no saturar el servicio que falla. Cuando un mensaje agota sus intentos se envia a una cola de mensajes fallidos, donde se conserva el contexto necesario para investigarlo. El procesamiento de esa cola debe ser controlado y auditable.

## Operacion

Las metricas mas utiles son la profundidad de la cola, la edad del mensaje mas antiguo, la tasa de errores y el tiempo de procesamiento. Tambien conviene establecer limites de capacidad y alertas para detectar consumidores bloqueados o productores que generan trabajo mas rapido de lo que puede procesarse.