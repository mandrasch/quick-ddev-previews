import { z } from 'zod'
import { createInvite } from '../../utils/users'
import { dashboardOrigin } from '../../utils/origin'

// POST /api/users/invite: owner-only. Creates an invite and returns the
// one-time URL for the owner to share out-of-band (no SMTP).
const body = z.object({
  email: z.string().email(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (!user.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Owner only' })
  }

  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Valid email required' })
  }

  const { token } = createInvite(parsed.data.email, user.email)
  const origin = dashboardOrigin() || getRequestURL(event).origin
  const url = `${origin}/setup?invite=${token}`

  return { url }
})
