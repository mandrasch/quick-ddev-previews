import { request as httpRequest } from 'node:http'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { runs } from '../db/schema'
import { IDE_DEFAULT_SETTINGS, IDE_PORT } from '../daemon/ide'
import { resolvePreview, forgetPreview } from '../daemon/sandbox'
import { getUserByEmail } from './users'
import { getRunBySlug } from './entities'
import {
  IDE_LABEL,
  parsePreviewHost,
  previewHostname,
  previewKey,
  stripPreviewPrefix,
} from '../../shared/utils/preview-host'

// The web IDE's origin: `ide--<slug>.preview.<host>` (the label `ide` is
// reserved, see shared/utils/preview-host.ts). Unlike app previews nothing is
// rewritten or injected beyond the workbench defaults: openvscode-server
// speaks same-origin URLs natively. Two legs:
//
//   HTTP: proxyRunIde, wired into the preview middleware like app previews.
//   WebSocket: the workbench lives on ws connections with arbitrary paths, so
//   route-based ws handlers can't serve it. wrapWebsocketResolve intercepts
//   h3's ws route resolution (the cached `websocket.resolve` every crossws
//   adapter consults, dev and prod) and returns pipe-through hooks for IDE
//   origins; everything else (the run terminal) falls through to normal
//   resolution.
//
// Both legs gate on the same session + live-membership check as private app
// previews (the IDE is an admin tool, not part of a preview's visibility) and
// bump the idle clock, so an open IDE keeps its environment alive.

function bumpPreviewSeen(runId: number): void {
  db.update(runs).set({ previewLastSeen: new Date() }).where(eq(runs.id, runId)).run()
}

// ── HTTP leg ──────────────────────────────────────────────────────────────────

export async function proxyRunIde(event: H3Event, slug: string): Promise<void> {
  const run = getRunBySlug(slug)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  if (run.envState !== 'up') {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }

  // Only the canonical host is served, mirroring app previews: tls-ask blocks
  // certificates for anything else; this is the second wall for requests that
  // bypass Caddy (direct app access, dev).
  const reqHost = (event.node.req.headers.host ?? '').toLowerCase()
  const canonicalHost = previewHostname(previewKey(run), stripPreviewPrefix(reqHost), IDE_LABEL)
  if (reqHost !== canonicalHost) throw createError({ statusCode: 404, statusMessage: 'Run not found' })

  // Reading the session must never WRITE one (see preview-proxy.ts): the IDE
  // makes credential-less subresource requests that would otherwise clobber
  // the operator's live session with an empty domain-scoped cookie.
  const session = await getUserSession(event)
  removeResponseHeader(event, 'set-cookie')
  if (!session?.user) {
    const reqUrl = getRequestURL(event)
    if (!String(getRequestHeader(event, 'accept') ?? '').includes('text/html')) {
      throw createError({ statusCode: 401, statusMessage: 'Login required' })
    }
    const baseHost = stripPreviewPrefix(reqUrl.host)
    setCookie(event, 'quickddevpreviews-redirect', `${reqUrl.protocol}//${reqUrl.host}${reqUrl.pathname}${reqUrl.search}`, {
      domain: process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN || undefined,
      path: '/',
      maxAge: 600,
      sameSite: 'lax',
    })
    sendRedirect(event, `${reqUrl.protocol}//${baseHost}/login`, 302)
    return
  }
  // Same per-request re-check as the /api gate: a removed user's still-valid
  // session must not open an IDE.
  if (!getUserByEmail(session.user.email)) {
    await clearUserSession(event)
    throw createError({ statusCode: 403, statusMessage: 'Membership revoked' })
  }

  const ip = await resolvePreview(run.id)
  if (!ip) throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })

  bumpPreviewSeen(run.id)

  const url = getRequestURL(event)
  const req = event.node.req
  const res = event.node.res
  // The workbench DOCUMENT gets buffered so the IDE defaults can be injected
  // into its embedded configuration; everything else streams as-is.
  const wantsHtml = String(getRequestHeader(event, 'accept') ?? '').includes('text/html')
  const headers = { ...req.headers }
  if (wantsHtml) headers['accept-encoding'] = 'identity'
  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest(
      { host: ip, port: IDE_PORT, method: req.method, path: `${url.pathname}${url.search}`, headers },
      (up) => {
        const isHtml = /text\/html/i.test(String(up.headers['content-type'] ?? ''))
        const buffer = wantsHtml && isHtml && !up.headers['content-encoding']
        res.statusCode = up.statusCode ?? 502
        for (const [key, value] of Object.entries(up.headers)) {
          if (value === undefined) continue
          if (buffer && (key.toLowerCase() === 'content-length' || key.toLowerCase() === 'transfer-encoding')) continue
          res.setHeader(key, value)
        }
        if (!buffer) {
          up.pipe(res)
          up.on('end', () => resolve())
          up.on('error', reject)
          return
        }
        const chunks: Buffer[] = []
        up.on('data', (c: Buffer) => chunks.push(c))
        up.on('end', () => {
          const body = Buffer.from(injectIdeDefaults(Buffer.concat(chunks).toString('utf8')), 'utf8')
          res.setHeader('content-length', String(body.byteLength))
          res.end(body)
          resolve()
        })
        up.on('error', reject)
      },
    )
    upstream.on('error', (e) => {
      forgetPreview(run.id)
      reject(e)
    })
    req.pipe(upstream)
  }).catch((e: NodeJS.ErrnoException) => {
    if (e?.code === 'ECONNREFUSED' || e?.code === 'EHOSTUNREACH' || e?.code === 'ETIMEDOUT') {
      throw createError({ statusCode: 503, statusMessage: 'The IDE is not running. Open it from the run page.' })
    }
    throw e
  })
}

// The workbench HTML carries its whole boot configuration in one meta tag
// (`vscode-workbench-web-configuration`, attribute-escaped JSON). The web
// workbench registers default overrides ONLY from the TOP-LEVEL
// `configurationDefaults` key of these construction options; a
// `productConfiguration.configurationDefaults` reaches the product service but
// nothing in the web client reads it. So: decode, merge the IDE defaults into
// the top-level key (defaults only: the user's own browser-side settings still
// win), re-encode.
const decodeAttr = (v: string): string => v.replaceAll('&quot;', '"').replaceAll('&amp;', '&')
const encodeAttr = (v: string): string => v.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

function injectIdeDefaults(html: string): string {
  return html.replace(
    /(id="vscode-workbench-web-configuration"[^>]*data-settings=")([^"]*)(")/,
    (match, pre: string, encoded: string, post: string) => {
      try {
        const cfg = JSON.parse(decodeAttr(encoded)) as { configurationDefaults?: Record<string, unknown> }
        cfg.configurationDefaults = {
          ...cfg.configurationDefaults,
          ...IDE_DEFAULT_SETTINGS,
        }
        return pre + encodeAttr(JSON.stringify(cfg)) + post
      }
      catch {
        // Not the JSON we expected: serve it untouched rather than break the IDE.
        return match
      }
    },
  )
}

// ── WebSocket leg ─────────────────────────────────────────────────────────────

// The upgrade request shapes differ per adapter (node vs dev): read the Host
// header defensively from whatever carries it.
function upgradeHost(source: { headers?: unknown, request?: { headers?: unknown } }): string {
  const headers = source.headers ?? source.request?.headers
  if (!headers) return ''
  if (headers instanceof Headers) return headers.get('host') ?? ''
  return String((headers as Record<string, unknown>).host ?? '')
}

// The run's slug for an IDE-origin upgrade request, or null for anything else.
function ideSlugRef(source: { headers?: unknown, request?: { headers?: unknown } }): string | null {
  const host = upgradeHost(source).split(':')[0] ?? ''
  const ref = parsePreviewHost(host)
  return ref?.label === IDE_LABEL ? ref.slug : null
}

interface Pipe {
  // Null until resolvePreview + the backend connection are set up; client
  // frames that arrive in that window queue below.
  backend: WebSocket | null
  // Client frames arriving before the backend socket opens are queued.
  queue: (string | Uint8Array<ArrayBuffer>)[]
  runId: number
  lastBump: number
}
const pipes = new Map<string, Pipe>()

// crossws hooks piping every frame between the browser and the container's
// IDE server. Frame types must be preserved: the workbench protocol is binary.
const ideWsHooks = {
  async upgrade(request: { headers?: unknown, url?: string }) {
    const session = await getUserSession(request as Parameters<typeof getUserSession>[0])
    if (!session?.user) {
      throw createError({ statusCode: 401, statusMessage: 'Login required' })
    }
    if (!getUserByEmail(session.user.email)) {
      throw createError({ statusCode: 403, statusMessage: 'Membership revoked' })
    }
    const slug = ideSlugRef(request)
    const run = slug === null
      ? null
      : db.select().from(runs).where(eq(runs.slug, slug)).get()
    if (!run || run.envState !== 'up') {
      throw createError({ statusCode: 409, statusMessage: 'Environment is not running' })
    }
  },

  async open(peer: { id: string, request?: { url?: string, headers?: unknown }, send: (data: unknown) => void, close: (code?: number, reason?: string) => void }) {
    const slug = ideSlugRef(peer.request ?? {})
    if (slug === null) return peer.close(1011, 'Environment is not running')
    const run = db.select().from(runs).where(eq(runs.slug, slug)).get()
    if (!run) return peer.close(1011, 'Run not found')
    // Register the pipe BEFORE the awaited resolvePreview: crossws does not
    // await this hook, so the workbench's earliest frames (a reconnect after a
    // restart, cold ipCache) can arrive mid-await. With the pipe present they
    // queue instead of hitting message() with no pipe and being dropped.
    const pipe: Pipe = { backend: null, queue: [], runId: run.id, lastBump: 0 }
    pipes.set(peer.id, pipe)
    const ip = await resolvePreview(run.id)
    if (!ip) {
      pipes.delete(peer.id)
      return peer.close(1011, 'Environment is not running')
    }
    const path = (() => {
      try {
        const url = new URL(peer.request?.url ?? '/', 'http://localhost')
        return `${url.pathname}${url.search}`
      }
      catch {
        return '/'
      }
    })()
    const backend = new WebSocket(`ws://${ip}:${IDE_PORT}${path}`)
    backend.binaryType = 'arraybuffer'
    pipe.backend = backend
    backend.onopen = () => {
      for (const frame of pipe.queue) backend.send(frame)
      pipe.queue = []
    }
    backend.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      peer.send(typeof e.data === 'string' ? e.data : new Uint8Array(e.data))
    }
    backend.onclose = () => peer.close()
    backend.onerror = () => peer.close(1011, 'IDE connection failed')
  },

  message(peer: { id: string }, message: { rawData?: unknown, text: () => string, uint8Array: () => Uint8Array }) {
    const pipe = pipes.get(peer.id)
    if (!pipe) return
    const data = message.uint8Array() as Uint8Array<ArrayBuffer>
    if (pipe.backend?.readyState === WebSocket.OPEN) pipe.backend.send(data)
    else pipe.queue.push(data)
    const now = Date.now()
    if (now - pipe.lastBump > 30_000) {
      pipe.lastBump = now
      bumpPreviewSeen(pipe.runId)
    }
  },

  close(peer: { id: string }) {
    const pipe = pipes.get(peer.id)
    pipes.delete(peer.id)
    if (pipe?.backend && pipe.backend.readyState <= WebSocket.OPEN) pipe.backend.close()
  },
}

// Intercept h3's cached websocket route resolution: IDE-origin upgrades get
// the pipe-through hooks, everything else (the run terminal, future ws
// routes) resolves normally. Called once from a nitro plugin.
export function wrapWebsocketResolve(h3App: { websocket: { resolve: (info: never) => unknown } }): void {
  const ws = h3App.websocket
  const original = ws.resolve.bind(ws)
  ws.resolve = (info: never) => {
    if (ideSlugRef(info) !== null) return ideWsHooks
    return original(info)
  }
}
