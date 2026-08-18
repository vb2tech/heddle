import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Kept in sync with server/index.mjs, which reads the same variables. Without
// this the proxy would keep pointing at the default port after PORT moved the
// API — and on a machine already running something there, it would silently
// talk to the wrong server rather than fail.
const API_PORT = Number(process.env.PORT || 4317)
const UI_PORT = Number(process.env.UI_PORT || 5317)

export default defineConfig({
  server: {
    port: UI_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist' },
  plugins: [react()],
})
