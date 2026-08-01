import { getSettings } from '../utils/settings'
import { defaultSshTarget } from '../utils/ssh'

// GET /api/settings: instance settings for the settings page. Only public-ish
// values: the SSH target (used to build the run page's copy command) and the
// concurrency limit.
export default defineEventHandler(async () => {
  const s = getSettings()
  return {
    sshTarget: s.sshTarget ?? null,
    sshTargetDefault: defaultSshTarget(),
    maxConcurrentRuns: s.maxConcurrentRuns,
  }
})
