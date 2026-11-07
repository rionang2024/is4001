import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built site works from any folder or GitHub Pages sub-path
// Question A's minute data is served by Qn_A/api (uvicorn app:app --port 8000); /api is proxied to it in dev and preview.
const api = { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } }

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { proxy: api },
  preview: { proxy: api },
})
