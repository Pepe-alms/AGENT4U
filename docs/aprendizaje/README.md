# docs/aprendizaje

Material del plan de 22 sesiones para recuperar el control de AGENT4U (ver `PLAN.md`).

```
docs/aprendizaje/
├── PLAN.md               # calendario y temario de las 22 sesiones
├── PROMPT_REVISION.md    # prompt para que Claude Code revise tu ejercicio
├── ARCHITECTURE.md       # se construye sesión a sesión (lo escribes tú)
├── pildoras/dia-XX.md    # la píldora de cada día (la escribe Claude, 8:30)
└── entregas/dia-XX.md    # tu entrega de cada día (la escribes tú)
```

## Flujo de cada día

`main` está protegida (solo por PR), así que esta carpeta vive en una rama propia: **`aprendizaje`**.

1. A las 8:30 te llega la píldora por correo. También queda en `pildoras/dia-XX.md` de la rama `aprendizaje`.
2. Haces el código del ejercicio en una rama `ejercicio/dia-XX`, creada desde `main`.
3. Rellenas `entregas/dia-XX.md` (a partir de `entregas/PLANTILLA.md`) **en la rama `aprendizaje`** y haces push.
4. Si quieres feedback inmediato, abre Claude Code en VS Code y pega `PROMPT_REVISION.md`.
5. Antes de las 8:30 del día siguiente, tu entrega tiene que estar en `origin/aprendizaje`. Si hay código, sube también tu rama `ejercicio/dia-XX`.
6. La píldora siguiente empieza con una crítica de tu entrega y del código de tu rama `ejercicio/dia-XX`.

Al terminar el plan, una sola PR `aprendizaje → main` lleva todo el material a `main`.

## Reglas

- Claude solo escribe dentro de `docs/aprendizaje/`. El resto del repo es tuyo.
- Los cambios de código de los ejercicios van en tus ramas `ejercicio/dia-XX`. Que lleguen a `main` lo decides tú.
- Si un día no entregas, no pasa nada: la píldora siguiente sigue el plan y anota que falta esa entrega.
