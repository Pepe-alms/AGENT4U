# Etapa 1: compilar. VITE_API_URL sale de .env.production (/api), que Vite
# cocina dentro del bundle; nginx proxea /api/ al gateway en la etapa 2.
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Etapa 2: servir. Solo el bundle estatico y la configuracion de nginx; nada de
# Node ni de node_modules en la imagen final.
FROM nginx:1.27-alpine

COPY despliegue/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
