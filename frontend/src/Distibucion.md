# Qué va en cada carpeta

| Carpeta | Va | NO va |
|---|---|---|
| `api/` | URLs, `fetch`, JSON, tipos del backend | `useState`, JSX, cualquier import de React |
| `features/x/` | El hook con el estado + los componentes de esa función | Componentes que use otra feature |
| `components/ui/` | Botón, Spinner, Aviso: cosas sin significado | La palabra "mensaje", "fuente" o "documento" |
| `hooks/` | Lógica React reutilizable y genérica | Cualquier URL o nombre de endpoint |
| `lib/` | Funciones puras: formatear fechas, generar ids | React, y el dominio |
| `routes/` | Qué componente se pinta en qué URL | Lógica de negocio: solo compone |
| `styles/` | Variables, reset, tipografía base | Ni una sola clase CSS |
