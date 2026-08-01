import { isGithubAppConfigured, saveGithubAppCredentials } from '../../../utils/github-credentials'

// GET /setup/github/callback: where GitHub lands after the owner creates the
// app from the manifest. We exchange the one-time `code` for the app's full
// credentials, store them (encrypted), and send the owner on to install the
// app on their repos. First-run only: once configured, the flow is locked.
//
// This route is PUBLIC (the callback URL has to be reachable before GitHub
// lands back here), but the CSRF state cookie was set by the owner-only
// manifest endpoint, so a stranger can't trigger it without the state.
interface Conversion {
  id: number
  slug: string
  html_url: string
  client_id: string
  client_secret: string
  pem: string
  webhook_secret: string | null
}

export default defineEventHandler(async (event) => {
  // Locked after first setup: never let a second app overwrite the first.
  if (isGithubAppConfigured()) {
    return sendRedirect(event, '/settings')
  }

  const query = getQuery(event)
  const expected = getCookie(event, 'quickddevpreviews-gh-setup-state')
  deleteCookie(event, 'quickddevpreviews-gh-setup-state', { path: '/' })
  if (!query.code || !expected || query.state !== expected) {
    return sendRedirect(event, '/settings?error=state')
  }

  try {
    const app = await $fetch<Conversion>(
      `https://api.github.com/app-manifests/${query.code}/conversions`,
      { method: 'POST', headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'quickddevpreviews' } },
    )

    saveGithubAppCredentials({
      appId: app.id,
      slug: app.slug,
      htmlUrl: app.html_url,
      clientId: app.client_id,
      clientSecret: app.client_secret,
      privateKey: app.pem,
      webhookSecret: app.webhook_secret,
    })

    // Straight into installing the app on the operator's repos.
    return sendRedirect(event, `${app.html_url}/installations/new`)
  }
  catch (error) {
    console.error('GitHub App manifest conversion failed:', error)
    return sendRedirect(event, '/settings?error=conversion')
  }
})
