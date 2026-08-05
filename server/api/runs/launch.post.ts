import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { projects, runs } from '../../db/schema'
import { dispatchRuns } from '../../daemon/runner'
import { isValidSlug } from '../../../shared/utils/preview-host'
import { hashScrypt } from '../../utils/passwords'

// POST /api/runs/launch: create (or reuse) the project row from the picked
// repo, then queue a run for it. The dispatcher picks it up and boots the
// preview. Body carries everything the launch form collected.
const envVarSchema = z.object({ key: z.string().min(1), value: z.string() })

const body = z.object({
  repo: z.object({
    githubId: z.number(),
    owner: z.string(),
    name: z.string(),
    fullName: z.string(),
    defaultBranch: z.string(),
    private: z.boolean(),
    cloneUrl: z.string(),
  }),
  branch: z.string().optional(),
  startCommand: z.string().optional(),
  envVars: z.array(envVarSchema).default([]),
  // Phase 8: every run gets a human-readable subdomain. The launcher always
  // sends one (a random slug by default); the runId form is gone.
  slug: z.string(),
  visibility: z.enum(['private', 'password', 'public']).optional(),
  previewPassword: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Invalid request' })
  }

  const { repo, branch, startCommand, envVars, visibility, previewPassword } = parsed.data
  const slug = parsed.data.slug.trim().toLowerCase()

  if (!isValidSlug(slug)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid slug: lowercase letters, digits and dashes only; no leading/trailing dash, no double dash.',
    })
  }
  if (visibility === 'password' && !previewPassword) {
    throw createError({ statusCode: 400, statusMessage: 'A preview password is required for password-protected previews' })
  }

  // Upsert the project row.
  const existing = db.select().from(projects).where(eq(projects.githubId, repo.githubId)).get()
  const project = existing
    ?? db.insert(projects)
      .values({
        githubId: repo.githubId,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        private: repo.private,
        cloneUrl: repo.cloneUrl,
      })
      .returning()
      .get()

  // Queue the run.
  let run
  try {
    run = db.insert(runs)
      .values({
        projectId: project.id,
        branch: branch || repo.defaultBranch,
        startCommand: startCommand || null,
        envVars,
        slug,
        visibility: visibility || 'private',
        previewPasswordHash: visibility === 'password' ? hashScrypt(previewPassword!) : null,
        previewPasswordVersion: visibility === 'password' ? 1 : 0,
      })
      .returning()
      .get()
  }
  catch (e) {
    if ((e as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw createError({ statusCode: 409, statusMessage: `Slug "${slug}" is already in use` })
    }
    throw e
  }

  // Poke the dispatcher for an instant start.
  void dispatchRuns()

  return { runId: run.id, projectId: project.id }
})
