import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Question A's page code lives in Qn_A/ui, outside this folder, so the dev server may read the repo root
// and shared packages are always taken from this folder's node_modules.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

// base './' so the built site works from any folder or GitHub Pages sub-path
// Question A's minute data is served by Qn_A/api (uvicorn app:app --port 8000); /api is proxied to it in dev and preview.
const api = { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } }

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: { dedupe: ['react', 'react-dom', 'recharts'] },
  server: { proxy: api, fs: { allow: [repoRoot] } },
  preview: { proxy: api },
})
