import { createHmac, timingSafeEqual } from 'node:crypto'

// The preview-password gate (Phase 8, visibility = 'password'). A visitor
// without an admin session proves access with a signed cookie:
//
//   name:  qdp-preview-pw
//   value: <base64url(runId:version:expiresAt)>.<base64url(hmac(payload))>
//
// The signature key is NUXT_SESSION_PASSWORD (already mandatory), so the
// cookie cannot be forged without it. The runId check makes a cookie issued
// for one run useless on another (they all share the Domain=preview.<base>
// scope); the version check makes a password change revoke every outstanding
// cookie instantly; the expiry bounds the cookie's life.
//
// maxAge is configurable via QUICKDDEVPREVIEWS_PREVIEW_PW_MAX_AGE_DAYS
// (default 7). No sliding renewal: re-authenticate when it lapses.

export const QDP_PREVIEW_PW_COOKIE = 'qdp-preview-pw'

export function previewPasswordCookieDomain(): string | undefined {
  const base = process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN
  // Scoped one level above the preview hosts (<key>.preview.<base>) so the
  // cookie reaches every label variant of a run but never the dashboard.
  return base ? `preview.${base}` : undefined
}

export function previewPasswordMaxAgeSec(): number {
  const days = Number(process.env.QUICKDDEVPREVIEWS_PREVIEW_PW_MAX_AGE_DAYS || 7)
  return Number.isFinite(days) && days > 0 ? Math.round(days * 24 * 60 * 60) : 7 * 24 * 60 * 60
}

export function issuePreviewPasswordToken(runId: number, version: number, now = Date.now()): string {
  const payload = Buffer.from(`${runId}:${version}:${now + previewPasswordMaxAgeSec() * 1000}`).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifyPreviewPasswordToken(token: string, runId: number, version: number): boolean {
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const payload = token.slice(0, dot)
  const candidate = Buffer.from(sign(payload))
  const expected = Buffer.from(token.slice(dot + 1))
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return false

  const parts = Buffer.from(payload, 'base64url').toString('utf8').split(':')
  if (parts.length !== 3) return false
  const [rid, ver, exp] = parts
  return Number(rid) === runId && Number(ver) === version && Number(exp) > Date.now()
}

function sign(payload: string): string {
  const password = process.env.NUXT_SESSION_PASSWORD
  if (!password) return ''
  return createHmac('sha256', password).update(payload).digest('base64url')
}
