import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { runs } from '../../db/schema'
import { requireRun } from '../../utils/entities'
import { hashScrypt } from '../../utils/passwords'

// PATCH /api/runs/:id: change a run's preview visibility and/or its preview
// password AFTER launch (Phase 8). The slug itself is fixed at launch (it is
// baked into the ddev env's translated URLs, see daemon/ddev.ts).
const body = z.object({
  visibility: z.enum(['private', 'password', 'public']).optional(),
  previewPassword: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  const run = requireRun(id)

  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Invalid request' })
  }
  const { visibility, previewPassword } = parsed.data

  const targetVisibility = visibility ?? run.visibility
  const changingPassword = previewPassword !== undefined
  const hasPasswordAfter = changingPassword ? previewPassword !== '' : !!run.previewPasswordHash

  if (targetVisibility === 'password' && !hasPasswordAfter) {
    throw createError({ statusCode: 400, statusMessage: 'Set a preview password before enabling password protection' })
  }

  const patch: {
    visibility?: 'private' | 'password' | 'public'
    previewPasswordHash?: string | null
    previewPasswordVersion?: number
  } = {}
  if (visibility !== undefined) patch.visibility = visibility
  if (changingPassword) {
    patch.previewPasswordHash = previewPassword ? hashScrypt(previewPassword) : null
    // Bump on ANY change so outstanding qdp-preview-pw cookies are revoked.
    patch.previewPasswordVersion = run.previewPasswordVersion + 1
  }

  db.update(runs).set(patch).where(eq(runs.id, id)).run()
  return { ok: true }
})
