import { request as httpRequest } from 'node:http'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { runs } from '../db/schema'
import { resolvePreview, forgetPreview } from '../daemon/sandbox'
import { getUserByEmail } from './users'
import { previewLabel, stripPreviewPrefix } from '../../shared/utils/preview-host'
import { readDdevHosts, type DdevHosts } from '../daemon/ddev'
import { runCheckoutDir } from './storage'

// Reverse-proxy a whole request to a RUN's isolated ddev environment. Called
// from the preview-host middleware for requests to
// `[<label>--]<runId>.preview.<host>`.
//
// Phase 3 ships the 'env' mode only (the default): the run's env vars were
// already translated to the per-run preview origins at boot (daemon/ddev.ts),
// so the app natively speaks preview URLs and this proxy is a plain
// pass-through. The target is the run's web container at :80 over plain HTTP
// (its nginx serves any Host header). Only the iframe concerns remain: frame
// headers stripped, a small bridge script injected into HTML documents.
//
// Access is login-gated: the request must carry a valid session, sent
// cross-subdomain via the base-domain cookie. Logged out: a navigation
// redirects to login; subresources get 401.

// Injected into every proxied HTML document so the dashboard's embedded
// preview behaves like a browser: the frame reports each navigation to its
// parent (address bar) and takes back/forward/reload/go commands from it.
const BRIDGE_SCRIPT = `<script>(function () {
  if (window === window.parent) return
  var dash = location.protocol + '//' + location.host.replace(/^(?:[a-z0-9-]+--)?\\d+\\.preview\\./, '')
  addEventListener('message', function (e) {
    var d = e.data || {}
    if (e.origin !== dash || d.knecht !== 'cmd') return
    if (d.action === 'back') history.back()
    else if (d.action === 'forward') history.forward()
    else if (d.action === 'reload') location.reload()
    else if (d.action === 'go' && typeof d.url === 'string') location.href = d.url
  })
  parent.postMessage({ knecht: 'nav', href: location.href, title: document.title }, dash)
})()</script>`

function injectBridge(html: string): string {
  const openHead = /<head[^>]*>/i.exec(html)
  if (openHead) {
    const at = openHead.index + openHead[0].length
    return html.slice(0, at) + BRIDGE_SCRIPT + html.slice(at)
  }
  return html + BRIDGE_SCRIPT
}

export async function proxyRunPreview(event: H3Event, runId: number, label?: string): Promise<void> {
  const session = await getUserSession(event)
  // Reading the session must never WRITE one: for a request without a session
  // cookie, getUserSession seeds an empty session and emits a domain-scoped
  // Set-Cookie. Preview pages routinely make credential-less requests, and
  // that empty cookie would overwrite the operator's live session.
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
    return sendRedirect(event, `${reqUrl.protocol}//${baseHost}/login`, 302)
  }

  // Same per-request re-check as the /api gate: removing a user must also
  // revoke their still-valid session cookie here.
  if (!getUserByEmail(session.user.email)) {
    await clearUserSession(event)
    throw createError({ statusCode: 403, statusMessage: 'Membership revoked' })
  }

  const run = db.select().from(runs).where(eq(runs.id, runId)).get()
  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }
  if (run.envState !== 'up') {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }

  const hosts = runHosts(runId)
  const appHost = label
    ? hosts.all.find(h => previewLabel(h) === label)
    : hosts.primary
  if (!appHost) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown preview host' })
  }

  const sandboxAddr = await resolvePreview(runId)
  if (!sandboxAddr) {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }

  db.update(runs)
    .set({ previewLastSeen: new Date() })
    .where(eq(runs.id, runId))
    .run()

  const url = getRequestURL(event)
  const req = event.node.req
  const res = event.node.res

  const headers = { ...req.headers }
  if (String(headers['accept'] ?? '').includes('text/html')) {
    // HTML documents need to arrive uncompressed so the bridge is injectable.
    headers['accept-encoding'] = 'identity'
  }

  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest(
      {
        host: sandboxAddr,
        port: 80,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (up) => {
        const type = String(up.headers['content-type'] ?? '')
        const isHtml = /text\/html/i.test(type)
        const buffer = isHtml && !up.headers['content-encoding']

        res.statusCode = up.statusCode ?? 502
        for (const [key, value] of Object.entries(up.headers)) {
          if (value === undefined) continue
          const lower = key.toLowerCase()
          if (lower === 'x-frame-options') continue
          if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
            const values = (Array.isArray(value) ? value : [String(value)])
              .map(v => v.replace(/frame-ancestors[^;]*(;\s*|$)/i, '').trim())
              .filter(Boolean)
            if (values.length) res.setHeader(key, values)
            continue
          }
          if (buffer && (lower === 'content-length' || lower === 'transfer-encoding')) continue
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
          const body = injectBridge(Buffer.concat(chunks).toString('utf8'))
          const buf = Buffer.from(body, 'utf8')
          res.setHeader('content-length', String(buf.byteLength))
          res.end(buf)
          resolve()
        })
        up.on('error', reject)
      },
    )
    upstream.on('error', (e) => {
      forgetPreview(runId)
      reject(e)
    })
    req.pipe(upstream)
  }).catch((e: NodeJS.ErrnoException) => {
    if (e?.code === 'ECONNREFUSED' || e?.code === 'EHOSTUNREACH' || e?.code === 'ETIMEDOUT') {
      throw createError({ statusCode: 503, statusMessage: 'Environment is starting or failed to boot' })
    }
    throw e
  })
}

// The project's ddev host set, read from the run's checkout once and cached.
const hostsCache = new Map<number, DdevHosts>()

function runHosts(runId: number): DdevHosts {
  let hosts = hostsCache.get(runId)
  if (!hosts || !hosts.all.length) {
    hosts = readDdevHosts(runCheckoutDir(runId))
    hostsCache.set(runId, hosts)
  }
  return hosts
}
