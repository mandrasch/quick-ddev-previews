import { eq } from 'drizzle-orm'
import { db } from '../db'
import { projects, runs, type Project, type Run } from '../db/schema'

// Shared row lookups. `get*` returns undefined for missing rows (delete routes
// stay idempotent); `require*` fails 404.

export function getProject(id: number): Project | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get()
}

export function requireProject(id: number): Project {
  const row = getProject(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  return row
}

export function getRun(id: number): Run | undefined {
  return db.select().from(runs).where(eq(runs.id, id)).get()
}

export function getRunBySlug(slug: string): Run | undefined {
  return db.select().from(runs).where(eq(runs.slug, slug)).get()
}

export function requireRun(id: number): Run {
  const row = getRun(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  return row
}
