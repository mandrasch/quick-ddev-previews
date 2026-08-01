import { getInstallationClient } from './github-app'

// The repo's `.ddev/config.yaml` parsed as a flat object. Best-effort: every
// field falls back to null. Used by the launcher to show the DDEV env spec and
// to read the webserver type, db type/version etc.

export interface DdevConfig {
  type: string | null
  webserverType: string | null
  phpVersion: string | null
  nodejsVersion: string | null
  database: { type: string | null, version: string | null }
  additionalHostnames: string[]
  additionalFqdns: string[]
}

const DEFAULTS: DdevConfig = {
  type: null,
  webserverType: null,
  phpVersion: null,
  nodejsVersion: null,
  database: { type: null, version: null },
  additionalHostnames: [],
  additionalFqdns: [],
}

// Parse a yaml-lite string into the fields we care about. ddev's `config.yaml`
// is a flat yaml with `database: type:version` as a string column, so we don't
// want a full yaml dep just for this: a line-based parse is enough.
function parseDdevConfig(text: string): DdevConfig {
  const out: DdevConfig = { ...DEFAULTS, database: { type: null, version: null } }
  const lines = text.split('\n')
  let inFqdns = false
  const fqdns: string[] = []
  let inHostnames = false
  const hostnames: string[] = []
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim() || line.trim().startsWith('#')) continue
    const m = /^([a-zA-Z_]+):\s*(.*)$/.exec(line.trim())
    if (!m) continue
    const [, key, value] = m
    if (value === undefined) continue
    switch (key) {
      case 'type':
        out.type = value || null
        break
      case 'webserver_type':
        out.webserverType = value || null
        break
      case 'php_version':
        out.phpVersion = value || null
        break
      case 'nodejs_version':
        out.nodejsVersion = value || null
        break
      case 'database': {
        const parts = value.split(':')
        out.database = { type: parts[0] || null, version: parts[1] || null }
        break
      }
      case 'additional_hostnames':
        inHostnames = !value
        if (value) hostnames.push(...value.split(',').map(s => s.trim()).filter(Boolean))
        break
      case 'additional_fqdns':
        inFqdns = !value
        if (value) fqdns.push(...value.split(',').map(s => s.trim()).filter(Boolean))
        break
      default:
        if (inHostnames && line.startsWith('  -')) hostnames.push(line.replace(/^\s*-\s*/, '').trim())
        if (inFqdns && line.startsWith('  -')) fqdns.push(line.replace(/^\s*-\s*/, '').trim())
        if (!line.startsWith(' ') && !line.startsWith('-')) inHostnames = inFqdns = false
        break
    }
  }
  out.additionalHostnames = hostnames
  out.additionalFqdns = fqdns
  return out
}

export async function fetchDdevConfig(
  owner: string,
  repo: string,
  ref?: string,
): Promise<DdevConfig | null> {
  const octokit = await getInstallationClient(owner, repo)
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: '.ddev/config.yaml',
      ...(ref ? { ref } : {}),
    })
    if ('content' in data && data.encoding === 'base64') {
      const text = Buffer.from(data.content, 'base64').toString('utf8')
      return parseDdevConfig(text)
    }
  }
  catch (e) {
    if ((e as { status?: number }).status === 404) return null
    throw e
  }
  return null
}
