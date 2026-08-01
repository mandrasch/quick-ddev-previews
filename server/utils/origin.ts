// The dashboard's public origin, for URLs built SERVER-side (invite links,
// later webhook endpoints). Prod sets QUICKDDEVPREVIEWS_BASE_DOMAIN and https
// is implied; dev, where scheme and port differ, overrides with the full
// QUICKDDEVPREVIEWS_BASE_URL.
export function dashboardOrigin(): string {
  const url = process.env.QUICKDDEVPREVIEWS_BASE_URL
  if (url) return url.replace(/\/+$/, '')
  const domain = process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN
  return domain ? `https://${domain}` : ''
}
