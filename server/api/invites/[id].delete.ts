import { deleteInvite } from '../../utils/users'

// DELETE /api/invites/:id: owner-only. Revokes an open invite.
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (!user.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Owner only' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid invite id' })
  }

  deleteInvite(id)
  return { ok: true }
})
