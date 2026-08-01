// Secure-by-default gate. Every /api/** route requires a logged-in session, so
// new routes are protected automatically: no need to remember
// requireUserSession per handler. Only the auth and setup endpoints are exempt.
export default defineEventHandler(async (event) => {
  const { pathname } = getRequestURL(event)

  // Pages, assets, the auth flow (/auth/**) render/handle their own access.
  if (!pathname.startsWith('/api/')) return

  // nuxt-auth-utils' own session endpoint must stay reachable when logged out
  // (the client uses it to learn whether there IS a session).
  if (pathname.startsWith('/api/_auth/')) return

  // First-run setup endpoints are public: before an owner exists nobody can
  // log in, so the setup page must be able to read status and register.
  if (pathname.startsWith('/api/_setup/')) return

  // Login and logout are their own public endpoints.
  if (pathname === '/api/auth/login' || pathname === '/api/auth/logout') return

  await requireUserSession(event)
})
