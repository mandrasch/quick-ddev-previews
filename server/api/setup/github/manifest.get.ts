import { randomBytes } from 'node:crypto'
import { dashboardOrigin } from '../../../utils/origin'
import { isGithubAppConfigured } from '../../../utils/github-credentials'

// GET /api/setup/github/manifest: owner-only. Returns the GitHub App manifest
// + CSRF state to POST to GitHub. Once configured, the flow is locked.
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (!user.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Owner only' })
  }

  if (isGithubAppConfigured()) {
    return { configured: true as const }
  }

  const origin = dashboardOrigin()
  if (!origin) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Set QUICKDDEVPREVIEWS_BASE_URL (dev) or QUICKDDEVPREVIEWS_BASE_DOMAIN (prod) so the GitHub App callback URLs can be built.',
    })
  }

  const state = randomBytes(16).toString('hex')
  setCookie(event, 'quickddevpreviews-gh-setup-state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  // App names are globally unique on GitHub (and capped at 34 chars), so a
  // fixed name could only ever be claimed by a single instance worldwide.
  // A 5-char random suffix lets one operator run multiple servers without
  // name collisions; the creator can still edit the pre-filled name on
  // GitHub's confirmation page before the app is made.
  const suffix = randomBytes(4).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 5)
  const manifest = {
    name: `Quick DDEV previews - ${suffix}`,
    url: origin,
    description: 'Boot DDEV preview environments from your repos.',
    redirect_url: `${origin}/setup/github/callback`,
    setup_url: `${origin}/settings`,
    // No callback_urls: email/password stays the only login. Repo access is
    // via the app id + private key (server-side, no user OAuth).
    public: true,
    default_permissions: {
      contents: 'read',
      metadata: 'read',
      pull_requests: 'write',
    },
    // No default_events / hook_attributes: GitHub requires a non-blank webhook
    // URL when events are specified, but the webhook endpoint doesn't exist
    // yet (Phase 3). The app permissions alone enable repo access (clone, PRs).
    // Webhook events + the /api/github/webhook endpoint land in Phase 3.
  }

  return {
    configured: false as const,
    state,
    manifest,
  }
})
