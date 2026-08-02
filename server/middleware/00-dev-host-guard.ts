// Dev-only guard for a footgun: the session cookie is scoped to
// QUICKDDEVPREVIEWS_BASE_DOMAIN so the preview subdomains share the login, and
// a request whose Host is NOT under that domain never carries the session and
// silently bounces to /login. When a base domain is set in dev, reject those
// hosts with a pointer to the correct URL instead of serving a broken app.
// Named "00-" so it runs before the auth gate and the preview proxy. Prod is
// unaffected: Caddy owns the host names there.
export default defineEventHandler((event) => {
  if (!import.meta.dev) return
  const base = process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN
  if (!base) return

  const hostHeader = event.node.req.headers.host ?? ''
  const [host = '', port] = hostHeader.split(':')
  if (host === base || host.endsWith(`.${base}`)) return

  const url = port ? `http://${base}:${port}` : `http://${base}`
  setResponseStatus(event, 421)
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Wrong dev host</title></head>
<body style="font-family:system-ui,sans-serif;background:#111;color:#eee;padding:2rem">
  <h1>Open this dev server through ${base}</h1>
  <p>The session cookie is scoped to <code>${base}</code> so the preview
  subdomains share the login. The dashboard is at
  <a href="${url}" style="color:#a3e635">${url}</a>.
  Or unset <code>QUICKDDEVPREVIEWS_BASE_DOMAIN</code> for UI-only dev on
  localhost.</p>
</body>
</html>`
})
