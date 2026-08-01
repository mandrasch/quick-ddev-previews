import { listRepoBranches } from '../../../../../utils/github-app'

// GET /api/github/repos/:owner/:name/branches: the repo's branch names for
// the branch picker. The caller passes owner + name as path params.
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner')
  const name = getRouterParam(event, 'name')
  if (!owner || !name) throw createError({ statusCode: 400, statusMessage: 'owner and name required' })

  const branches = await listRepoBranches(owner, name)
  return branches
})
