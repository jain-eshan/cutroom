import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // Must stay in sync with server/main.py's CORS allow_origins -- README
    // and ARCHITECTURE.md both document this as the frontend's port.
    port: 3460,
  },
})
