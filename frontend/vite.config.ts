import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // jsdom y no el navegador: estas pruebas son de lógica y de árbol
    // renderizado, no de pintado. Lo visual se valida aparte, en Chrome.
    environment: 'jsdom',
    globals: true,
    // Los ficheros de prueba viven junto a lo que prueban: así se ven al
    // leer el código y no hay que mantener una carpeta espejo.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/pruebas/preparar.ts'],
  },
  server: {
    // El backend solo permite CORS desde localhost:3000 y localhost:5173
    // (backend/app/api/main.py:10). Si Vite saltase a otro puerto por estar
    // el 5173 ocupado, todas las peticiones fallarian por CORS con pinta de
    // averia del backend. Mejor que no arranque a que arranque roto.
    port: 5173,
    strictPort: true,
  },
});
