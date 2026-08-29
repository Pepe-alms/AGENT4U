# Estrategia de pruebas de software

Una estrategia de pruebas combina verificaciones automaticas y manuales para reducir el riesgo de cambios. Las pruebas unitarias comprueban unidades pequenas en aislamiento; las pruebas de integracion verifican la comunicacion con bases de datos o servicios; y las pruebas de extremo a extremo recorren un flujo completo.

## Piramide de pruebas

La mayor parte de la suite debe ser rapida y estable, por lo que conviene mantener muchas pruebas unitarias, menos pruebas de integracion y un numero reducido de pruebas de extremo a extremo. Cada nivel detecta fallos distintos y tiene un coste diferente de ejecucion y mantenimiento.

## Datos y aislamiento

Una prueba debe preparar sus propios datos y limpiar los recursos que crea. Los dobles de prueba son utiles cuando una dependencia externa es lenta, cara o no determinista, pero no deben sustituir todas las pruebas contra la implementacion real. Los datos sensibles deben anonimizarse antes de entrar en cualquier entorno de pruebas.

## Integracion continua

La integracion continua ejecuta comprobaciones en cada cambio y publica el resultado junto con la revision. Los fallos deben ser reproducibles y mostrar un mensaje diagnostico claro. Las pruebas inestables se investigan y corrigen, porque ignorarlas reduce la confianza en toda la suite.