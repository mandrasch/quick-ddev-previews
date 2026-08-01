import { listUsers, listOpenInvites } from '../../utils/users'

// GET /api/users: owner-only. Lists all users and open invites.
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (!user.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Owner only' })
  }

  return {
    users: listUsers().map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      isOwner: u.isOwner,
      createdAt: u.createdAt,
    })),
    invites: listOpenInvites().map(i => ({
      id: i.id,
      email: i.email,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })),
  }
})
