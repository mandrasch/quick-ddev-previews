// POST /api/auth/logout: clear the session cookie.
export default defineEventHandler(async (event) => {
  await clearUserSession(event)
  return { ok: true }
})
