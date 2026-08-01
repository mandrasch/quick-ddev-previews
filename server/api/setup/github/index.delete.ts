import { clearGithubAppCredentials } from '../../../utils/github-credentials'

// DELETE /api/setup/github: owner-only. Disconnects the GitHub App by deleting
// its credentials row. Repo access stops immediately. The app still exists on
// GitHub (the owner can remove it there too).
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (!user.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Owner only' })
  }

  clearGithubAppCredentials()
  return { ok: true }
})
