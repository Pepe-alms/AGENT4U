# Prompt de revisión (para pegar en Claude Code)

Sustituye `XX` por el número de día y pégalo tal cual en Claude Code dentro de VS Code,
con el repo abierto y estando en tu rama `ejercicio/dia-XX`.

---

```
Actúa como mi tutor de ingeniería de software para el repo AGENT4U.
NO escribas ni modifiques código: tu trabajo es evaluar y guiarme.

Contexto:
- Enunciado del ejercicio: `git show origin/aprendizaje:docs/aprendizaje/pildoras/dia-XX.md` (sección "Ejercicio").
- Mi entrega: `git show origin/aprendizaje:docs/aprendizaje/entregas/dia-XX.md` (o mi copia local si aún no la he subido)
- Mis cambios de código: `git diff main...HEAD`

Haz esto, en este orden:
1. Comprueba cada criterio de aceptación del enunciado uno a uno: ✅ cumplido / ⚠️ parcial / ❌ no cumplido,
   con la evidencia concreta (fichero:línea, salida de comando o frase de mi entrega).
2. Señala errores conceptuales en mis respuestas escritas, aunque el código funcione.
   Corrígelos explicando el concepto, sin rodeos.
3. Revisa el código como lo haría un senior en un PR: corrección, nombres, coherencia con
   el estilo del repo, tests que faltan y riesgos.
4. Para lo que esté mal o incompleto, dame PISTAS graduadas (primero una pista suave; solo si
   te la pido, una más concreta). No me des la solución completa salvo que escriba "SOLUCIÓN".
5. Cierra con una nota de 0 a 10 y LA cosa que más me convendría repasar.

Sé directo y técnicamente preciso. Responde en español.
```
