# Observabilidad de servicios

La observabilidad permite entender el estado interno de un sistema a partir de sus salidas. Sus tres señales principales son logs, metricas y trazas distribuidas. Los logs registran eventos con contexto; las metricas resumen valores numericos a lo largo del tiempo; y las trazas siguen una solicitud entre varios servicios.

## Metricas esenciales

Para una API conviene vigilar latencia, trafico, errores y saturacion. La latencia se puede observar con percentiles como p50, p95 y p99, porque una media puede ocultar colas lentas. Las alertas deben expresar sintomas accionables, por ejemplo un aumento sostenido de respuestas 5xx o del tiempo p95.

## Trazas y contexto

Cada solicitud debe llevar un identificador de correlacion que se propague entre servicios. Una traza se divide en spans, y cada span puede incluir el servicio, la operacion, la duracion y el resultado. No se deben incluir contrasenas, tokens ni datos personales en atributos o logs.

## Respuesta ante incidentes

Cuando una alerta se activa, el equipo debe confirmar el impacto, acotar el cambio que lo provoco y aplicar una mitigacion reversible. Despues se documentan la linea temporal, las evidencias y las acciones preventivas. Un buen informe busca mejorar el sistema y el proceso, no asignar culpas.