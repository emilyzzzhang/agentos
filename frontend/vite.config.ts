import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backend = process.env.AGENTOS_BACKEND_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // The browser only ever talks to /api; the API key stays on the backend.
      '/api': {
        target: backend,
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
  },
} as any)
