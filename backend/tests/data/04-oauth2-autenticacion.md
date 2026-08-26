# OAuth 2.0 y autenticación delegada

OAuth 2.0 es un marco de autorización que permite a una aplicación obtener acceso limitado a los recursos de un usuario en otro servicio, sin que el usuario tenga que compartir sus credenciales. Se especificó en el RFC 6749, publicado en octubre de 2012, junto al RFC 6750 que define el uso de tokens de tipo portador.

Conviene subrayar una distinción que se confunde con frecuencia: OAuth 2.0 es un marco de **autorización**, no de autenticación. Para autenticación se emplea OpenID Connect, una capa de identidad construida sobre OAuth 2.0 que añade el token de identidad en formato JWT.

## Roles del marco

El marco define cuatro roles. El propietario del recurso es el usuario final que posee los datos. El cliente es la aplicación que solicita acceso. El servidor de autorización emite los tokens tras autenticar al propietario. El servidor de recursos alberga los datos protegidos y valida los tokens recibidos.

## Flujo de código de autorización

Es el flujo recomendado para la mayoría de escenarios. La aplicación redirige al usuario al servidor de autorización, este autentica al usuario y le pide consentimiento, y devuelve un código de autorización de un solo uso a la URL de redirección registrada. La aplicación intercambia después ese código por un token de acceso mediante una llamada de servidor a servidor.

La ventaja de este doble paso es que el token nunca viaja por el navegador ni queda registrado en el historial ni en los registros de los servidores intermedios.

## PKCE

La extensión Proof Key for Code Exchange, definida en el RFC 7636 en septiembre de 2015, protege el flujo de código de autorización frente a la interceptación del código. El cliente genera un valor aleatorio llamado verificador de código, calcula su resumen SHA-256 y envía ese resumen como desafío en la primera petición. Al canjear el código debe presentar el verificador original.

PKCE nació para aplicaciones móviles y nativas, donde no es posible guardar un secreto de cliente, pero la práctica recomendada actual, recogida en el borrador de OAuth 2.1, es aplicarlo también en aplicaciones web con servidor.

## Flujos y su vigencia

| Flujo | Uso recomendado |
|---|---|
| Código de autorización con PKCE | Recomendado en todos los casos |
| Credenciales de cliente | Comunicación entre servicios sin usuario |
| Implícito | Obsoleto, no debe usarse |
| Contraseña del propietario | Obsoleto, no debe usarse |

## Tokens de acceso y de refresco

El token de acceso tiene una vida corta, habitualmente entre cinco minutos y una hora, para limitar el daño si se filtra. El token de refresco permite obtener un token de acceso nuevo sin volver a molestar al usuario, y por eso debe almacenarse con mayor protección. La rotación de tokens de refresco, en la que cada uso invalida el anterior y emite uno nuevo, permite detectar el robo de un token cuando se intenta reutilizar uno ya consumido.
