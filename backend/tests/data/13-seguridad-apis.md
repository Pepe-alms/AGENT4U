# Seguridad de APIs

La seguridad de una API debe diseñarse desde el contrato y mantenerse durante todo el ciclo de vida. Cada endpoint debe validar la entrada, autenticar al cliente cuando corresponda y autorizar la accion sobre el recurso concreto. Autenticacion confirma quien llama; autorizacion decide que puede hacer.

## Proteccion de solicitudes

Las entradas se validan con esquemas que establecen tipos, longitudes y valores permitidos. Los mensajes de error no deben revelar consultas internas, credenciales ni detalles de infraestructura. Los limites de tasa reducen abuso y ayudan a proteger dependencias costosas, mientras que los timeouts evitan dejar conexiones ocupadas indefinidamente.

## Credenciales y sesiones

Los secretos no deben almacenarse en el codigo ni enviarse en la URL. Se guardan en un gestor de secretos y se rotan con una frecuencia definida. Los tokens deben tener una vida limitada y los permisos minimos necesarios. Las operaciones sensibles deben quedar registradas sin guardar el token completo.

## Cambios y dependencias

Los cambios incompatibles requieren una version nueva o un periodo de transicion documentado. Antes de publicar se revisan dependencias, configuracion de CORS, cabeceras de seguridad y controles de acceso. Las pruebas deben cubrir tanto respuestas autorizadas como intentos de acceder a recursos de otro usuario.