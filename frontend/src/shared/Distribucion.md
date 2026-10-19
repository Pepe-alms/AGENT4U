# Qué va en cada carpeta

Estructura por features (roadmap T01). La regla de oro no cambia: una carpeta
define qué puede importar, no solo dónde viven los ficheros.

| Carpeta          | Va                                                     | NO va                                        |
| ---------------- | ------------------------------------------------------ | -------------------------------------------- |
| `app/`           | Composición raíz: proveedores, layout, rutas           | Lógica de negocio o llamadas a la API        |
| `shared/api/`    | URLs, `fetch`, JSON, tipos del backend                 | `useState`, JSX, cualquier import de React   |
| `features/<x>/`  | El hook con el estado + los componentes de esa función | Componentes que use otra feature             |
| `shared/ui/`     | Botón, Spinner, Aviso: cosas sin significado           | La palabra "mensaje", "fuente" o "documento" |
| `shared/lib/`    | Funciones puras: formatear fechas, generar ids         | React, y el dominio                          |
| `shared/hooks/`  | Lógica React reutilizable y genérica                   | Cualquier URL o nombre de endpoint           |
| `app/routes/`    | Qué componente se pinta en qué URL                     | Lógica de negocio: solo compone              |
| `shared/styles/` | Variables, reset, tipografía base                      | Ni una sola clase CSS                        |

## Imports

Siempre con el alias `@/`, nunca con rutas relativas que suban de carpeta
(`../../`). `@/` apunta a `src/`, y está configurado en dos sitios que deben
ir a la vez: `paths` en `tsconfig.app.json` y `resolve.alias` en `vite.config.ts`.
