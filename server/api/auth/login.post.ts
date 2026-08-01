import { z } from 'zod'
import { verifyScrypt } from '../../utils/passwords'
import { getUserByEmail, toSessionUser } from '../../utils/users'

// POST /api/auth/login: email + password -> sealed session cookie.
const body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  redirect: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  }

  const { email, password } = parsed.data
  const user = getUserByEmail(email)

  if (!user || !verifyScrypt(password, user.passwordHash)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }

  await setUserSession(event, { user: toSessionUser(user) })
  return { ok: true }
})
