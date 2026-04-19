import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'))

// En dev, le front appelle `/api/*` (même origine) → proxy vers FastAPI pour éviter les blocages CORS (souvent sur DELETE).
// Il faut loadEnv : les clés du `.env` ne sont pas dans process.env tant que la config est évaluée (sinon VITE_PROXY_TARGET est ignoré).
export default defineConfig(({ mode }) => {
  // Toujours lire `.env` à côté de ce fichier : si `npm run dev` est lancé avec un cwd ailleurs,
  // `process.cwd()` ne voit pas VITE_PROXY_TARGET → fallback 8010 → proxy vers de vieux uvicorn (réponse /health 3.0.0).
  const env = loadEnv(mode, __dirname, '')
  const proxyTarget = env.VITE_PROXY_TARGET || process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8020'
  const devPort = Number.parseInt(env.VITE_DEV_PORT || '4000', 10) || 4000

  const buildIso = new Date().toISOString()

  return {
    root: __dirname,
    envDir: __dirname,
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
      __APP_REVISION_AT__: JSON.stringify(buildIso),
    },
    plugins: [react(), tailwindcss()],
    server: {
      port: devPort,
      strictPort: false,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '') || '/',
        },
      },
    },
  }
})
