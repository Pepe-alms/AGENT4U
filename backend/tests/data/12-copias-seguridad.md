# Politica de copias de seguridad

Una politica de copias de seguridad define que datos se protegen, con que frecuencia se copian y cuanto tiempo se conservan. El objetivo no es solo evitar la perdida de informacion, sino cumplir un tiempo de recuperacion y un punto de recuperacion aceptables.

## RPO y RTO

El RPO indica la cantidad maxima de datos que la organizacion puede perder medida en tiempo. Un RPO de una hora exige que las copias o la replicacion permitan recuperar como maximo la ultima hora. El RTO indica cuanto tiempo puede permanecer indisponible el servicio antes de que deba restaurarse.

## Estrategia de retencion

Una estrategia habitual combina copias completas, incrementales y una copia aislada del entorno principal. Las copias deben cifrarse durante la transferencia y en reposo, y el acceso debe estar restringido a cuentas de recuperacion. La regla 3-2-1 recomienda conservar tres copias, en dos medios diferentes y una fuera del entorno principal.

## Pruebas de restauracion

Una copia que nunca se ha restaurado no puede considerarse fiable. Cada trimestre se debe seleccionar un conjunto representativo, restaurarlo en un entorno separado y medir el RTO real. El resultado debe incluir errores, permisos, integridad de los archivos y cualquier diferencia respecto al procedimiento documentado.