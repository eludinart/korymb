# Unified Next.js frontend image
# Coolify : utiliser le build pack « Dockerfile » (racine /Dockerfile), pas Nixpacks.
FROM node:20-alpine
WORKDIR /app

ARG NEXT_PUBLIC_KORYMB_API_URL
ENV NEXT_PUBLIC_KORYMB_API_URL=$NEXT_PUBLIC_KORYMB_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
COPY admin/package*.json ./admin/
# NODE_ENV=production avant npm ci omet les devDependencies (tailwind, postcss, typescript).
RUN npm ci && npm --prefix admin ci

COPY . .
RUN test -f admin/lib/chatJobAgents.ts && test -f admin/lib/chatMirrorDisplay.ts

ENV NODE_ENV=production
ENV NEXT_DIST_DIR=.next-build
ENV PORT=3000
RUN npm run build

RUN npm --prefix admin prune --omit=dev

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const http=require('node:http');const port=process.env.PORT||3000;const req=http.get({host:'127.0.0.1',port,path:'/',timeout:4000},res=>process.exit(res.statusCode>=200&&res.statusCode<500?0:1));req.on('error',()=>process.exit(1));req.on('timeout',()=>{req.destroy();process.exit(1);});"
CMD ["npm", "--prefix", "admin", "run", "start"]
