import { spawn, type ChildProcess } from 'node:child_process'
import type { ServerResponse } from 'node:http'
import net from 'node:net'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Must stay in sync with src/lib/api.ts's API_BASE and server/main.py's port.
const SERVICE_PORT = 8787
const LOG_LINES = 40

type ServiceState = 'starting' | 'running' | 'exited' | 'external'
type Service = {
  child: ChildProcess | null
  state: ServiceState
  log: string[]
  // Whether it got as far as serving requests -- the difference between
  // "couldn't start" and "stopped" on the setup screen.
  ranBefore: boolean
}

// Kept on globalThis because Vite re-evaluates this file whenever the config
// changes; a module-level variable would forget the running service and start
// a second one.
const holder = globalThis as typeof globalThis & {
  __cutroomService?: Service
  __cutroomExitHooked?: boolean
}
const service: Service = (holder.__cutroomService ??= {
  child: null,
  state: 'starting',
  log: [],
  ranBefore: false,
})

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

// Lines that would bury the one that matters: the access log of this app's
// own polling (health every 1.5s, progress every 700ms), and a harmless macOS
// warning about two Python packages each bundling ffmpeg.
const NOISE = [/"GET \/(health|progress\/)[^"]*" \d{3}/, /^objc\[\d+\]:/]

function remember(chunk: Buffer) {
  for (const line of chunk.toString().split('\n')) {
    if (line.trim() && !NOISE.some((pattern) => pattern.test(line))) service.log.push(line)
  }
  service.log.splice(0, Math.max(0, service.log.length - LOG_LINES))
}

async function startService() {
  if (service.child) return
  // Someone already runs it (a second terminal, an IDE launch config): use
  // theirs rather than failing on a taken port.
  if (await portInUse(SERVICE_PORT)) {
    service.state = 'external'
    return
  }
  service.log.length = 0
  service.state = 'starting'
  service.ranBefore = false
  const child = spawn(
    'uv',
    ['run', '--directory', 'server', 'uvicorn', 'main:app', '--port', String(SERVICE_PORT)],
    { cwd: __dirname },
  )
  service.child = child
  child.stdout?.on('data', remember)
  child.stderr?.on('data', (chunk: Buffer) => {
    remember(chunk)
    if (chunk.toString().includes('Application startup complete')) {
      service.state = 'running'
      service.ranBefore = true
    }
  })
  child.on('error', (err) => {
    service.log.push(
      `Couldn't start the processing service: ${err.message}. It needs uv installed — see https://docs.astral.sh/uv/`,
    )
    service.state = 'exited'
    service.child = null
  })
  child.on('exit', (code) => {
    if (service.state !== 'exited') {
      service.log.push(`The processing service stopped (exit code ${code ?? 'none'}).`)
    }
    service.state = 'exited'
    service.child = null
  })
}

function stopServiceWithDevServer() {
  if (holder.__cutroomExitHooked) return
  holder.__cutroomExitHooked = true
  const stop = () => service.child?.kill()
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
      void startService()

      const send = (res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            state: service.state,
            log: service.log,
            ranBefore: Boolean(service.ranBefore),
          }),
        )
      }
      server.middlewares.use('/__service/restart', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        void startService().then(() => send(res))
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
