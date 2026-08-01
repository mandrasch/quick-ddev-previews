import { z } from 'zod'
import { db } from '../../db'
import { getUserByEmail, hasOwner, isInviteOpen, createUser, consumeInvite, getInviteByToken, toSessionUser } from '../../utils/users'
import { hashPassword } from '../../utils/passwords'

// POST /api/_setup/register: creates the first user (the owner) when no owner
// exists, OR redeems an invite token to create a non-owner user. One endpoint,
// two paths, decided by whether an `invite` token is in the body.
const body = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  name: z.string().optional(),
  invite: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Invalid request' })
  }

  const { email, password, name, invite: token } = parsed.data

  // Already registered? No reason to be here.
  if (hasOwner() && !token) {
    throw createError({ statusCode: 409, statusMessage: 'Instance is already set up' })
  }

  // Invite redemption: validate token inside a transaction with the user insert
  // so a concurrent request can't double-consume.
  if (token) {
    const session = db.transaction(() => {
      const invite = getInviteByToken(token)
      if (!invite) throw createError({ statusCode: 400, statusMessage: 'Invalid invite token' })
      if (!isInviteOpen(invite)) throw createError({ statusCode: 400, statusMessage: 'Invite has expired or been used' })

      // The email from the form must match the invited email.
      if (email.trim().toLowerCase() !== invite.email) {
        throw createError({ statusCode: 400, statusMessage: 'Email does not match the invite' })
      }

      if (getUserByEmail(email)) {
        throw createError({ statusCode: 409, statusMessage: 'A user with this email already exists' })
      }

      const user = createUser({
        email,
        passwordHash: hashPassword(password),
        name: name || null,
        invitedBy: invite.createdBy,
      })
      consumeInvite(invite.id)

      return toSessionUser(user)
    })

    await setUserSession(event, { user: session })
    return { ok: true }
  }

  // Owner registration (no invite): the first user claims the instance.
  if (getUserByEmail(email)) {
    throw createError({ statusCode: 409, statusMessage: 'A user with this email already exists' })
  }

  const user = createUser({
    email,
    passwordHash: hashPassword(password),
    name: name || null,
    isOwner: true,
  })

  await setUserSession(event, { user: toSessionUser(user) })
  return { ok: true }
})
