import { githubAppInfo } from '../../../utils/github-credentials'

// GET /api/setup/github/info: owner-only. Returns the configured GitHub App's
// public info (no secrets). Used by the settings page to show connection state.
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (!user.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Owner only' })
  }

  return githubAppInfo()
})
