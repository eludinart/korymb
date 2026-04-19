# Étape 1 : build
FROM node:20-alpine AS builder
WORKDIR /app
# Injectées au build Vite (Coolify : définir comme variables de build / build args).
ARG VITE_AI_BACKEND_URL
ARG VITE_AGENT_SECRET
ENV VITE_AI_BACKEND_URL=$VITE_AI_BACKEND_URL
ENV VITE_AGENT_SECRET=$VITE_AGENT_SECRET
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Étape 2 : servir avec Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
