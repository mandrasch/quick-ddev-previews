import { currentVersion, isNewerVersion, listReleases } from '../../utils/version'

// GET /api/system/releases -> the changelog. Kept out of /api/system (which
// the System page fetches on load) because release bodies are only needed when
// the changelog renders. `isNew` marks versions the instance would gain by
// updating; on dev builds everything is old news.
export default defineEventHandler(async () => {
  const current = currentVersion()
  const releases = await listReleases()
  return {
    current,
    releases: releases.map(r => ({ ...r, isNew: isNewerVersion(r.tag, current) })),
  }
})
