import { fetchFile } from '../../../../../utils/github-app'

// GET /api/github/repos/:owner/:name/env-example: the repo's `.env.example`
// contents at a given ref, for the "Copy .env.example" button. Returns
// `{ content: string | null }`.
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner')
  const name = getRouterParam(event, 'name')
  if (!owner || !name) throw createError({ statusCode: 400, statusMessage: 'owner and name required' })

  const query = getQuery(event)
  const ref = typeof query.ref === 'string' ? query.ref : undefined

  const content = await fetchFile(owner, name, '.env.example', ref)
  return { content }
})
