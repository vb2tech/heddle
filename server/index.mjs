// Local-only HTTP API for the orchestration dashboard.
//
// Reads are polled off ~/.claude and pushed to the browser over SSE. The only
// writes touch this app's own ideas file plus explicit, user-triggered spawns.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { snapshot, readTranscript, readHistory, readFileActivity, slugForCwd, CLAUDE_DIR } from './store.mjs'
import { createFeed } from './feed.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'data')
const TODOS_FILE = path.join(DATA_DIR, 'todos.json')
const LEGACY_IDEAS_FILE = path.join(DATA_DIR, 'ideas.json')
const LABELS_FILE = path.join(DATA_DIR, 'labels.json')

const PORT = Number(process.env.PORT || 4317)
const HOST = '127.0.0.1'
const POLL_MS = Number(process.env.POLL_MS || 1000)
const SERVE_DIST = process.argv.includes('--serve-dist')

// ------------------------------------------------------------------- todos

// Your durable backlog, distinct from the per-session task lists Claude builds
// for itself: these span sessions and projects and outlive any of them.
// Array order is the user's manual ordering — no separate sort key to drift.
function loadTodos() {
  for (const file of [TODOS_FILE, LEGACY_IDEAS_FILE]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* try the next one */
    }
  }
  return []
}

function saveTodos(todos) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2))
}

const ADOPT_WINDOW_MS = 5 * 60 * 1000

/**
 * Link a launched todo to the session it started.
 *
 * `claude` is spawned in a new terminal, so its session id does not exist yet
 * when the launch returns. Instead we adopt the first session to register in
 * that directory afterwards, which is unambiguous in practice and simply does
 * not bind if you never launched anything. A todo can also be bound by hand.
 */
function adoptLaunchedTodos(sessions) {
  const todos = loadTodos()
  const taken = new Set(todos.map((t) => t.sessionId).filter(Boolean))
  let changed = false

  for (const t of todos) {
    if (t.sessionId || !t.launchedAt) continue
    if (Date.now() - t.launchedAt > ADOPT_WINDOW_MS) continue
    const match = sessions.find(
      (s) => s.cwd && s.cwd === t.cwd && !taken.has(s.sessionId) && s.startedAt >= t.launchedAt - 5000,
    )
    if (match) {
      t.sessionId = match.sessionId
      taken.add(match.sessionId)
      changed = true
    }
  }
  if (changed) saveTodos(todos)
  return changed
}

// ------------------------------------------------------------------ labels

// User-assigned names and colours, keyed by sessionId. Claude's own derived
// name is fine for one session but useless for telling four terminals apart.
function loadLabels() {
  try {
    return JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveLabels(labels) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(LABELS_FILE, JSON.stringify(labels, null, 2))
}

// ------------------------------------------------------- snapshot broadcast

const clients = new Set()
const feed = createFeed()

let lastSnapshot = snapshot()
feed.update(lastSnapshot)
lastSnapshot = { ...lastSnapshot, feed: feed.list(), todos: loadTodos() }
let lastSerialized = JSON.stringify({ ...lastSnapshot, at: 0 })

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) {
    try {
      res.write(payload)
    } catch {
      clients.delete(res)
    }
  }
}

function poll() {
  let next
  try {
    next = snapshot()
    feed.update(next)
    adoptLaunchedTodos(next.sessions)
    next = { ...next, feed: feed.list(), todos: loadTodos() }
  } catch (err) {
    console.error('[poll] snapshot failed:', err.message)
    return
  }
  // `at` always changes, so compare everything else to avoid pointless pushes.
  const serialized = JSON.stringify({ ...next, at: 0 })
  if (serialized !== lastSerialized) {
    lastSerialized = serialized
    lastSnapshot = next
    broadcast('snapshot', next)
  }
}

setInterval(poll, POLL_MS).unref?.()

// ------------------------------------------------------------------ helpers

function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': buf.length,
    'cache-control': 'no-store',
  })
  res.end(buf)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1e6) reject(new Error('body too large'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/** Single-quote for sh, so nothing in user text is interpreted by the shell. */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** AppleScript string literal — only backslash and double-quote need escaping. */
function appleScriptString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

function serveStatic(req, res, url) {
  const dist = path.join(ROOT, 'dist')
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'
  const file = path.join(dist, rel)
  if (!file.startsWith(dist) || !fs.existsSync(file)) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

// ------------------------------------------------------------------- routes

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const { pathname } = url

  // Dev runs the UI on Vite's origin; the API is loopback-only either way.
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  try {
    if (pathname === '/api/state') {
      return json(res, 200, lastSnapshot)
    }

    if (pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write(`event: snapshot\ndata: ${JSON.stringify(lastSnapshot)}\n\n`)
      clients.add(res)
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n')
        } catch {
          /* closed */
        }
      }, 20000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(res)
      })
      return
    }

    if (pathname === '/api/transcript') {
      const sessionId = url.searchParams.get('sessionId')
      const cwd = url.searchParams.get('cwd') || ''
      const slug = url.searchParams.get('slug') || (cwd ? slugForCwd(cwd) : '')
      const fromOffset = Number(url.searchParams.get('offset') || 0)
      if (!sessionId || !slug) return json(res, 400, { error: 'sessionId and slug/cwd required' })
      return json(res, 200, readTranscript(slug, sessionId, { fromOffset }))
    }

    if (pathname === '/api/files') {
      const sessionId = url.searchParams.get('sessionId')
      const cwd = url.searchParams.get('cwd') || ''
      const slug = url.searchParams.get('slug') || (cwd ? slugForCwd(cwd) : '')
      if (!sessionId || !slug) return json(res, 400, { error: 'sessionId and slug/cwd required' })
      return json(res, 200, { files: readFileActivity(slug, sessionId) })
    }

    if (pathname === '/api/feed') {
      return json(res, 200, { feed: feed.list(Number(url.searchParams.get('limit') || 150)) })
    }

    if (pathname === '/api/history') {
      return json(res, 200, { history: readHistory(Number(url.searchParams.get('limit') || 300)) })
    }

    if (pathname === '/api/todos') {
      if (req.method === 'GET') return json(res, 200, { todos: loadTodos() })

      if (req.method === 'POST') {
        const body = await readBody(req)
        const text = (body.text || '').trim()
        if (!text) return json(res, 400, { error: 'text required' })
        const todos = loadTodos()
        const todo = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          cwd: body.cwd || '',
          project: body.cwd ? path.basename(body.cwd) : '',
          status: 'open',
          sessionId: null,
          launchedAt: null,
          createdAt: Date.now(),
        }
        todos.unshift(todo)
        saveTodos(todos)
        return json(res, 200, { todos })
      }

      if (req.method === 'PATCH') {
        const body = await readBody(req)
        const todos = loadTodos()
        const todo = todos.find((t) => t.id === body.id)
        if (!todo) return json(res, 404, { error: 'not found' })
        if (body.text !== undefined) todo.text = String(body.text).slice(0, 2000)
        if (body.status !== undefined) todo.status = body.status
        if (body.cwd !== undefined) {
          todo.cwd = body.cwd
          todo.project = body.cwd ? path.basename(body.cwd) : ''
        }
        // null clears a binding; a string binds by hand.
        if (body.sessionId !== undefined) todo.sessionId = body.sessionId
        if (body.launchedAt !== undefined) todo.launchedAt = body.launchedAt
        saveTodos(todos)
        return json(res, 200, { todos })
      }

      if (req.method === 'DELETE') {
        const body = await readBody(req)
        saveTodos(loadTodos().filter((t) => t.id !== body.id))
        return json(res, 200, { todos: loadTodos() })
      }
    }

    // Manual ordering, expressed as the full id order so the array itself
    // stays the single source of truth.
    if (pathname === '/api/todos/reorder' && req.method === 'POST') {
      const body = await readBody(req)
      const ids = Array.isArray(body.ids) ? body.ids : null
      if (!ids) return json(res, 400, { error: 'ids array required' })
      const todos = loadTodos()
      const byId = new Map(todos.map((t) => [t.id, t]))
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean)
      // Anything the client did not mention keeps its place at the end.
      for (const t of todos) if (!ids.includes(t.id)) ordered.push(t)
      saveTodos(ordered)
      return json(res, 200, { todos: ordered })
    }

    if (pathname === '/api/labels') {
      if (req.method === 'GET') return json(res, 200, { labels: loadLabels() })

      if (req.method === 'PATCH') {
        const body = await readBody(req)
        if (!body.sessionId) return json(res, 400, { error: 'sessionId required' })
        const labels = loadLabels()
        const entry = { ...(labels[body.sessionId] || {}) }
        if (body.label !== undefined) entry.label = String(body.label).slice(0, 60)
        if (body.color !== undefined) entry.color = body.color
        // An empty label with no colour means "forget this session".
        if (!entry.label && !entry.color) delete labels[body.sessionId]
        else labels[body.sessionId] = entry
        saveLabels(labels)
        return json(res, 200, { labels })
      }
    }

    // Opens a brand-new terminal window running `claude`. Never touches an
    // existing session — there is no safe write path into a live one.
    if (pathname === '/api/spawn' && req.method === 'POST') {
      const body = await readBody(req)
      const cwd = body.cwd
      if (!cwd || !fs.existsSync(cwd)) return json(res, 400, { error: 'valid cwd required' })
      if (process.platform !== 'darwin') return json(res, 501, { error: 'spawn is macOS-only for now' })

      const parts = ['cd', shellQuote(cwd), '&&', 'claude']
      if (body.sessionId) parts.push('--resume', shellQuote(body.sessionId))
      if (body.prompt?.trim()) parts.push(shellQuote(body.prompt.trim()))

      const osa = `tell application "Terminal"\n activate\n do script ${appleScriptString(parts.join(' '))}\nend tell`
      const child = spawn('osascript', ['-e', osa], { stdio: 'ignore', detached: true })
      child.unref()

      if (body.todoId) {
        const todos = loadTodos()
        const todo = todos.find((t) => t.id === body.todoId)
        if (todo) {
          todo.status = 'doing'
          todo.launchedAt = Date.now()
          todo.cwd = cwd
          todo.sessionId = null
          saveTodos(todos)
        }
      }
      return json(res, 200, { ok: true, cwd, resumed: body.sessionId || null })
    }

    if (pathname === '/api/meta') {
      return json(res, 200, { claudeDir: CLAUDE_DIR, pollMs: POLL_MS, platform: process.platform })
    }

    if (SERVE_DIST && !pathname.startsWith('/api/')) return serveStatic(req, res, url)
    return json(res, 404, { error: 'not found' })
  } catch (err) {
    console.error('[api]', pathname, err)
    return json(res, 500, { error: err.message })
  }
})

// A clear message beats an unhandled EADDRINUSE stack trace, since colliding
// with an already-running instance is the most likely first-run failure.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nPort ${PORT} is already in use — another instance may be running.\n` +
        `Start on a different port with:  PORT=4400 npm run dev\n`,
    )
    process.exit(1)
  }
  throw err
})

server.listen(PORT, HOST, () => {
  console.log(`orchestration api  →  http://${HOST}:${PORT}`)
  console.log(`watching           →  ${CLAUDE_DIR}`)
  if (SERVE_DIST) console.log(`serving dist/      →  http://localhost:${PORT}`)
})

// `localhost` resolves to ::1 on macOS, so also take the IPv6 loopback. Still
// loopback-only — this never exposes the API beyond the machine.
const server6 = http.createServer(server.listeners('request')[0])
server6.listen(PORT, '::1', () => {}).on('error', () => {
  /* IPv6 unavailable or already taken; IPv4 is enough */
})
