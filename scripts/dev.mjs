// Runs the API server and the Vite dev server together, and tears both down on
// Ctrl-C so neither is left orphaned holding a port.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const procs = [
  spawn(process.execPath, ['server/index.mjs'], { cwd: ROOT, stdio: 'inherit' }),
  spawn('npx', ['vite'], { cwd: ROOT, stdio: 'inherit' }),
]

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const p of procs) {
    if (!p.killed) p.kill('SIGTERM')
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
for (const p of procs) p.on('exit', (code) => shutdown(code ?? 0))
