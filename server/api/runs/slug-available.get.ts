import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { runs } from '../../db/schema'
import { isValidSlug } from '../../../shared/utils/preview-host'

// GET /api/runs/slug-available?slug=<slug>: live availability check for the
// launcher's slug field. Also reports whether the slug is well-formed at all.
export default defineEventHandler((event) => {
  const slug = String(getQuery(event).slug ?? '').toLowerCase()
  if (!isValidSlug(slug)) return { available: false, valid: false }
  const taken = db.select().from(runs).where(eq(runs.slug, slug)).get()
  return { available: !taken, valid: true }
})
