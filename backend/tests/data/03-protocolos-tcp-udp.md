# Protocolos de transporte: TCP y UDP

La capa de transporte del modelo TCP/IP ofrece dos protocolos principales con filosofías opuestas: TCP, orientado a conexión y fiable, y UDP, sin conexión y sin garantías de entrega.

## TCP

El Transmission Control Protocol se especificó en el RFC 793, publicado en septiembre de 1981, y fue actualizado por el RFC 9293 en 2022. Su cabecera ocupa un mínimo de 20 bytes, ampliable hasta 60 bytes mediante opciones.

TCP establece la conexión mediante un saludo de tres vías: el cliente envía un segmento SYN, el servidor responde con SYN-ACK y el cliente confirma con ACK. El cierre ordenado requiere cuatro segmentos, con dos parejas FIN-ACK independientes, porque cada extremo cierra su sentido de la comunicación por separado.

La fiabilidad se consigue mediante números de secuencia, confirmaciones acumulativas y retransmisión por temporizador. El control de flujo se implementa con una ventana deslizante que el receptor anuncia en cada segmento, evitando que un emisor rápido sature a un receptor lento.

## Control de congestión

El control de congestión es distinto del control de flujo: protege a la red, no al receptor. Los algoritmos clásicos son arranque lento, evitación de congestión, retransmisión rápida y recuperación rápida, descritos en el RFC 5681. Desde 2016 Google impulsa el algoritmo BBR, que estima el ancho de banda y el tiempo de ida y vuelta en lugar de reaccionar únicamente a la pérdida de paquetes.

## UDP

El User Datagram Protocol se especificó en el RFC 768 en agosto de 1980. Su cabecera es de solo 8 bytes y contiene cuatro campos: puerto origen, puerto destino, longitud y suma de verificación. No establece conexión, no retransmite, no ordena y no controla la congestión.

Esa simplicidad es precisamente su ventaja en escenarios donde la latencia importa más que la integridad: voz sobre IP, videoconferencia, videojuegos en tiempo real y consultas DNS. Un paquete de voz perdido es preferible a un paquete de voz retransmitido que llega tarde.

## Comparativa

| Característica | TCP | UDP |
|---|---|---|
| RFC original | 793 | 768 |
| Tamaño mínimo de cabecera | 20 bytes | 8 bytes |
| Orientado a conexión | Sí | No |
| Garantiza el orden | Sí | No |
| Control de congestión | Sí | No |

## Puertos habituales

Los puertos del 0 al 1023 se consideran bien conocidos y su asignación la gestiona la IANA. HTTP utiliza el puerto 80 y HTTPS el 443, ambos sobre TCP. DNS emplea el puerto 53 tanto en UDP como en TCP: usa UDP para consultas normales y TCP cuando la respuesta supera los 512 bytes o para transferencias de zona. SSH escucha en el puerto 22 y SMTP en el 25.

## QUIC

QUIC, estandarizado en el RFC 9000 en mayo de 2021, se ejecuta sobre UDP e implementa en espacio de usuario las garantías que TCP ofrece en el núcleo del sistema operativo. Integra el cifrado TLS 1.3 en el propio establecimiento de la conexión, lo que reduce la latencia inicial, y elimina el bloqueo de cabecera de línea entre flujos independientes. Es la base del protocolo HTTP/3.
