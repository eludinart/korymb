# Unified Next.js frontend image
FROM node:20-alpine
WORKDIR /app

# Build-time env for frontend runtime config
ARG NEXT_PUBLIC_KORYMB_API_URL
ARG NEXT_PUBLIC_KORYMB_AGENT_SECRET
ENV NEXT_PUBLIC_KORYMB_API_URL=$NEXT_PUBLIC_KORYMB_API_URL
ENV NEXT_PUBLIC_KORYMB_AGENT_SECRET=$NEXT_PUBLIC_KORYMB_AGENT_SECRET
ENV PORT=3000

COPY package*.json ./
COPY admin/package*.json ./admin/
RUN npm ci && npm --prefix admin ci

COPY . .
RUN npm run build

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const http=require('node:http');const port=process.env.PORT||3000;const req=http.get({host:'127.0.0.1',port,path:'/dashboard',timeout:4000},res=>process.exit(res.statusCode>=200&&res.statusCode<500?0:1));req.on('error',()=>process.exit(1));req.on('timeout',()=>{req.destroy();process.exit(1);});"
CMD ["npm", "--prefix", "admin", "run", "start"]
