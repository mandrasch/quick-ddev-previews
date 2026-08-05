import { parsePreviewHost, previewHostname, previewKey } from '../../shared/utils/preview-host'
import { getRunBySlug } from '../utils/entities'

// Caddy's on_demand_tls "ask" endpoint (see Caddyfile): 200 means "issue a
// certificate for this hostname", any error status means refuse. This is the
// abuse guard Let's Encrypt issuance hangs on: without it, anyone resolving a
// random subdomain of the preview wildcard could drain the weekly certificate
// quota. Public by design (Caddy calls it unauthenticated); it lives outside
// /api/ so the session gate in server/middleware/auth.ts skips it.
export default defineEventHandler((event) => {
  const domain = String(getQuery(event).domain ?? '').toLowerCase()
  const base = (process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN || '').toLowerCase()
  if (!base || !domain) throw createError({ statusCode: 404 })

  if (domain === base) return 'ok'

  // Only the canonical form [<label>--]<slug>.preview.<base> of an existing
  // run qualifies; reconstruct and compare so nothing sneaks in around it.
  const ref = parsePreviewHost(domain)
  if (!ref) throw createError({ statusCode: 404 })
  const run = getRunBySlug(ref.slug)
  if (!run) throw createError({ statusCode: 404 })
  if (domain !== previewHostname(previewKey(run), base, ref.label)) throw createError({ statusCode: 404 })
  return 'ok'
})
