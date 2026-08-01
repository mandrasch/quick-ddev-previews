import { listAppRepositories } from '../../utils/github-app'
import { isGithubAppConfigured } from '../../utils/github-credentials'

// GET /api/github/repos: the repos the connected GitHub App is installed on,
// across all installations. Source for the "select a project" picker. Returns
// `{ configured: false }` when the app isn't connected yet (the launcher shows
// a friendly "connect first" state instead of a hard error).
export default defineEventHandler(async () => {
  if (!isGithubAppConfigured()) {
    return { configured: false as const, repos: [] }
  }

  const repos = await listAppRepositories()
  return {
    configured: true as const,
    repos: repos
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map(r => ({
        githubId: r.id,
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        defaultBranch: r.default_branch,
        private: r.private,
        cloneUrl: r.clone_url,
      })),
  }
})
