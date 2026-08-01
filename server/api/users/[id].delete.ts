import { deleteUser, getUserById } from '../../utils/users'

// DELETE /api/users/:id: owner-only. Removes a user. The owner row is
// protected (cannot delete self).
export default defineEventHandler(async (event) => {
  const { user: session } = await requireUserSession(event)
  if (!session.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Owner only' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid user id' })
  }

  const target = getUserById(id)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }
  if (target.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Cannot delete the owner' })
  }
  if (target.email === session.email) {
    throw createError({ statusCode: 403, statusMessage: 'Cannot delete yourself' })
  }

  deleteUser(id)
  return { ok: true }
})
