import type { ServerResponse } from 'node:http'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { createProcessingService } from './scripts/processing-service.mjs'

// Kept on globalThis because Vite re-evaluates this file whenever the config
// changes; a module-level variable would forget the running service and start
// a second one.
const holder = globalThis as typeof globalThis & {
  __cutroomService?: ReturnType<typeof createProcessingService>
  __cutroomExitHooked?: boolean
}
const service = (holder.__cutroomService ??= createProcessingService(__dirname))

function stopServiceWithDevServer() {
  if (holder.__cutroomExitHooked) return
  holder.__cutroomExitHooked = true
  const stop = () => service.stop()
  process.once('exit', stop)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      stop()
      process.exit()
    })
  }
}

/**
 * Starts the local processing service alongside the dev server, so running
 * Cutroom is one command and nobody has to open a second terminal. The setup
 * screen reads `GET /__service` to show progress or, if it fails to start,
 * what it said -- and `POST /__service/restart` to try again from the app.
 */
function processingService(): Plugin {
  return {
    name: 'cutroom-processing-service',
    apply: 'serve',
    configureServer(server) {
      stopServiceWithDevServer()
      void service.start()

      const send = (res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(service.status()))
      }
      server.middlewares.use('/__service/restart', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        void service.start().then(() => send(res))
      })
      server.middlewares.use('/__service', (_req, res) => send(res))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), processingService()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // Must stay in sync with server/main.py's CORS allow_origins -- README
    // and ARCHITECTURE.md both document this as the frontend's port.
    port: 3460,
  },
})
