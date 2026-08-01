import { hasOwner, isInviteOpen, getInviteByToken } from '../../utils/users'

// GET /api/_setup/status: public (see server/middleware/auth.ts). Tells the
// first-run setup page whether the instance already has an owner, and if an
// invite token is present in the query, whether it is valid.
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const configured = hasOwner()

  // If an invite token is provided, validate it and return the invite's email
  // so the setup page can pre-fill / lock the field.
  let invite: { email: string } | null = null
  if (query.invite) {
    const row = getInviteByToken(query.invite as string)
    if (row && isInviteOpen(row)) {
      invite = { email: row.email }
    }
  }

  return { configured, invite }
})
