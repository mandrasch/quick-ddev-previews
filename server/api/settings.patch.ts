import { z } from 'zod'
import { getSettings, updateSettings } from '../utils/settings'

// PATCH /api/settings: owner-only. Updates the SSH target the run page uses to
// build the copy-pasteable SSH command. Charset-restricted (no whitespace or
// quotes) so the value can be spliced verbatim into the ssh command line.
const body = z.object({
  sshTarget: z.string().trim().regex(/^[A-Za-z0-9._@-]+$/).max(200).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (!user.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Owner only' })
  }

  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Invalid request' })
  }

  // PATCH is partial: only update the keys that were sent.
  const current = getSettings()
  const sshTarget = parsed.data.sshTarget !== undefined ? parsed.data.sshTarget : current.sshTarget
  updateSettings({ sshTarget })

  return { ok: true }
})
