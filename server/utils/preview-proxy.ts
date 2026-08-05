import { request as httpRequest } from 'node:http'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { runs, type Run } from '../db/schema'
import { resolvePreview, forgetPreview } from '../daemon/sandbox'
import { getUserByEmail } from './users'
import {
  previewLabel,
  previewHostname,
  previewKey,
  stripPreviewPrefix,
  type PreviewHostRef,
} from '../../shared/utils/preview-host'
import { readDdevHosts, type DdevHosts } from '../daemon/ddev'
import { runCheckoutDir } from './storage'
import { getRunBySlug } from './entities'
import { verifyScrypt } from './passwords'
import {
  QDP_PREVIEW_PW_COOKIE,
  previewPasswordCookieDomain,
  previewPasswordMaxAgeSec,
  issuePreviewPasswordToken,
  verifyPreviewPasswordToken,
} from './preview-password'

// Reverse-proxy a whole request to a RUN's isolated ddev environment. Called
// from the preview-host middleware for requests to
// `[<label>--]<key>.preview.<host>` where <key> is a runId or a slug.
//
// Phase 3 shipped the 'env' mode only (the default): the run's env vars were
// already translated to the per-run preview origins at boot (daemon/ddev.ts),
// so the app natively speaks preview URLs and this proxy is a plain
// pass-through. The target is the run's web container at :80 over plain HTTP
// (its nginx serves any Host header). Only the iframe concerns remain: frame
// headers stripped, a small bridge script injected into HTML documents.
//
// Phase 8 adds a per-run visibility gate on top (schema: runs.visibility):
//   - 'private' (default): login-gated, the Phase 3 behavior. The request must
//     carry a valid session, sent cross-subdomain via the base-domain cookie.
//     Logged out: a navigation redirects to login; subresources get 401.
//   - 'password': admins (valid session + live membership) pass; everyone else
//     must present the signed qdp-preview-pw cookie or answer the prompt the
//     proxy itself serves (server/utils/preview-password.ts).
//   - 'public': no gate at all; the session is never even read, so no stray
//     empty session cookie is ever emitted.

// Injected into every proxied HTML document so the dashboard's embedded
// preview behaves like a browser: the frame reports each navigation to its
// parent (address bar) and takes back/forward/reload/go commands from it.
const BRIDGE_SCRIPT = `<script>(function () {
  if (window === window.parent) return
  var dash = location.protocol + '//' + location.host.replace(/^(?:[a-z0-9-]+--)?[a-z][a-z0-9-]*\\.preview\\./, '')
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

export async function proxyRunPreview(event: H3Event, ref: PreviewHostRef): Promise<string | undefined> {
  // Resolve the run FIRST: visibility decides which gate (if any) applies.
  const run = getRunBySlug(ref.slug)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  if (run.envState !== 'up') {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }

  // Only the canonical host of a run is served: the slug form and nothing
  // else, so a `public` random-slug preview is only reachable by its
  // unguessable URL. tls-ask enforces the same rule at the certificate level;
  // this is the second wall for requests that bypass Caddy (direct app
  // access, dev).
  const reqHost = (event.node.req.headers.host ?? '').toLowerCase()
  const canonicalHost = previewHostname(previewKey(run), stripPreviewPrefix(reqHost), ref.label)
  if (reqHost !== canonicalHost) throw createError({ statusCode: 404, statusMessage: 'Run not found' })

  if (run.visibility === 'password') {
    const session = await readSessionQuietly(event)
    const admin = session?.user && getUserByEmail(session.user.email)
    if (!admin) {
      // The prompt's form POSTs here on the SAME preview host; answer it before
      // the pass-through would swallow it.
      if (isPasswordSubmit(event)) return await handlePasswordSubmit(event, run)
      if (!hasValidPreviewPasswordCookie(event, run)) return renderPasswordPrompt(event, run)
    }
  }
  else if (run.visibility === 'public') {
    // No gate, and no session read at all: getUserSession would seed an empty
    // session and emit a domain-scoped Set-Cookie, and a public preview's
    // credential-less subresource requests would clobber the operator's live
    // session with that empty cookie.
  }
  else {
    // 'private' (the default), the Phase 3 behavior.
    const session = await readSessionQuietly(event)
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

    // Same per-request re-check as the /api gate: removing a user must also
    // revoke their still-valid session cookie here.
    if (!getUserByEmail(session.user.email)) {
      await clearUserSession(event)
      throw createError({ statusCode: 403, statusMessage: 'Membership revoked' })
    }
  }

  const hosts = runHosts(run.id)
  const appHost = ref.label
    ? hosts.all.find(h => previewLabel(h) === ref.label)
    : hosts.primary
  if (!appHost) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown preview host' })
  }

  const sandboxAddr = await resolvePreview(run.id)
  if (!sandboxAddr) {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }

  db.update(runs)
    .set({ previewLastSeen: new Date() })
    .where(eq(runs.id, run.id))
    .run()

  const url = getRequestURL(event)
  const req = event.node.req
  const res = event.node.res

  const headers = { ...req.headers }
  if (String(headers['accept'] ?? '').includes('text/html')) {
    // HTML documents need to arrive uncompressed so the bridge is injectable.
    headers['accept-encoding'] = 'identity'
  }

  // The qdp-preview-pw cookie is scoped to `preview.<base>` so it rides along
  // to EVERY preview host; the ddev app must never see it.
  const forwardedCookie = String(headers.cookie ?? '')
    .split(';')
    .map(c => c.trim())
    .filter(c => c && !c.toLowerCase().startsWith(`${QDP_PREVIEW_PW_COOKIE}=`))
    .join('; ')
  if (forwardedCookie) headers.cookie = forwardedCookie
  else delete headers.cookie

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
      forgetPreview(run.id)
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

// Reading the session must never WRITE one: for a request without a session
// cookie, getUserSession seeds an empty session and emits a domain-scoped
// Set-Cookie. Preview pages routinely make credential-less requests, and
// that empty cookie would overwrite the operator's live session.
async function readSessionQuietly(event: H3Event): Promise<{ user?: { email: string } } | null> {
  const session = await getUserSession(event)
  removeResponseHeader(event, 'set-cookie')
  return session
}

// ── Visibility gate: 'password' ───────────────────────────────────────────────

function isPasswordSubmit(event: H3Event): boolean {
  const url = getRequestURL(event)
  return event.node.req.method === 'POST' && url.pathname === '/__qdp_preview_auth__'
}

function hasValidPreviewPasswordCookie(event: H3Event, run: Run): boolean {
  const token = getCookie(event, QDP_PREVIEW_PW_COOKIE)
  if (!token) return false
  return verifyPreviewPasswordToken(token, run.id, run.previewPasswordVersion)
}

// Brute-force protection: in-memory lockout per run (5 wrong attempts in a
// row locks the run for 60 s). Lost on restart; a DB-persisted counter can
// wait for a later hardening phase.
const MAX_PASSWORD_ATTEMPTS = 5
const PASSWORD_LOCK_MS = 60_000
const passwordAttempts = new Map<number, { count: number, lockedUntil: number }>()

async function handlePasswordSubmit(event: H3Event, run: Run): Promise<string | undefined> {
  let body: { password?: unknown, next?: unknown } | null = null
  try {
    body = await readBody(event) as { password?: unknown, next?: unknown }
  }
  catch {
    // Malformed or missing body: treat as an empty submission.
  }
  const password = typeof body?.password === 'string' ? body.password : ''

  const now = Date.now()
  const state = passwordAttempts.get(run.id)
  if (state && state.lockedUntil > now) {
    return renderPasswordPrompt(event, run, { locked: true })
  }

  if (!run.previewPasswordHash || !verifyScrypt(password, run.previewPasswordHash)) {
    const count = (state?.count ?? 0) + 1
    passwordAttempts.set(run.id, {
      count,
      lockedUntil: count >= MAX_PASSWORD_ATTEMPTS ? now + PASSWORD_LOCK_MS : 0,
    })
    return renderPasswordPrompt(event, run, { error: 'Incorrect password' })
  }

  passwordAttempts.delete(run.id)
  setCookie(event, QDP_PREVIEW_PW_COOKIE, issuePreviewPasswordToken(run.id, run.previewPasswordVersion), {
    domain: previewPasswordCookieDomain(),
    path: '/',
    maxAge: previewPasswordMaxAgeSec(),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })

  // Back to the page the visitor actually tried to open (same-origin only).
  if (typeof body?.next === 'string' && body.next.startsWith('/') && !body.next.startsWith('//')) {
    sendRedirect(event, body.next, 302)
    return
  }
  const url = getRequestURL(event)
  sendRedirect(event, `${url.pathname}${url.search}`, 302)
  return
}

// The password prompt page, served BY THE PROXY (not the app): the ddev
// project never sees a visitor until they clear the gate. Returns the HTML so
// h3 sends it as the 401 body, which a browser or iframe renders normally.
function renderPasswordPrompt(event: H3Event, run: Run, opts?: { error?: string, locked?: boolean }): string {
  const url = getRequestURL(event)
  const next = `${url.pathname}${url.search}`
  const message = opts?.locked
    ? 'Too many attempts. Try again in a minute.'
    : opts?.error || null
  const errorHtml = message ? `<p class="error">${escapeHtml(message)}</p>` : ''

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview protected</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0b0b0d; color: #e7e7ea; }
  .card { width: min(92vw, 22rem); padding: 2rem; border-radius: 0.75rem;
    border: 1px solid #26262b; background: #141417; }
  h1 { margin: 0 0 0.25rem; font-size: 1.1rem; color: #fff; }
  p { margin: 0 0 1.25rem; font-size: 0.85rem; color: #9d9da6; }
  input { width: 100%; padding: 0.625rem 0.75rem; border-radius: 0.5rem;
    border: 1px solid #2e2e34; background: #0b0b0d; color: inherit;
    font-size: 0.9rem; outline: none; }
  input:focus { border-color: #84cc16; }
  button { width: 100%; margin-top: 0.75rem; padding: 0.625rem; border: 0;
    border-radius: 0.5rem; background: #84cc16; color: #101303;
    font-weight: 600; font-size: 0.9rem; cursor: pointer; }
  .error { color: #f87171; font-size: 0.8rem; margin: 0 0 0.25rem; }
  .host { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<form class="card" method="post" action="/__qdp_preview_auth__">
  <h1>Preview protected</h1>
  <p>Enter the preview password for <span class="host">${escapeHtml(url.host)}</span> to continue.</p>
  ${errorHtml}
  <input type="password" name="password" autocomplete="current-password" autofocus required>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <button type="submit">Continue</button>
</form>
</body>
</html>`

  setResponseStatus(event, 401)
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'cache-control', 'no-store')
  return html
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
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
