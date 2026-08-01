import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { previewHostname, previewLabel } from '../../shared/utils/preview-host'
import { dashboardOrigin } from '../utils/origin'
import { runSandboxName } from '../utils/storage'

export interface EnvVar {
  key: string
  value: string
}

// Per-container resource caps: all runs share the host daemon now, so one
// runaway build or query must not take the box down.
const WEB_MEM_LIMIT = '2g'
const DB_MEM_LIMIT = '1g'
const WEB_PIDS_LIMIT = 2048

const INGRESS_NETWORK = 'quickddevpreviews-ingress'

// Write the per-run ddev overrides (`.ddev/config.quickddevpreviews.yaml`,
// `.ddev/docker-compose.quickddevpreviews.yaml` and
// `.ddev/mysql/00-quickddevpreviews-lowmem.cnf`). ddev merges all
// `.ddev/config.*.yaml` and `.ddev/docker-compose.*.yaml` files, so this
// injects everything run-specific without touching the repo's tracked config:
//   - `name`: quickddevpreviews-run-<id>. All runs share ONE docker daemon, so
//     container/volume/network names must be unique per run.
//   - `web_environment`: the run's env vars, with every ddev-host URL in the
//     VALUES translated to its per-run preview origin (so a project that
//     derives all its URLs from env natively renders preview links).
//   - compose override: the web container joins the ingress network, gets
//     memory/pids caps, the db gets a memory cap.
// The project's own hostnames stay exactly as the repo ships them; the proxy
// maps the project's own hostnames to per-run preview origins instead.
// Returns how many env vars were written.
export function writeDdevConfig(checkoutDir: string, envVars: EnvVar[], runId: number): number {
  const doc: { name: string, web_environment?: string[] } = { name: runSandboxName(runId) }
  if (envVars.length) {
    const translate = envUrlTranslator(readDdevHosts(checkoutDir), runId)
    doc.web_environment = envVars.map(e => `${e.key}=${translate(unquote(e.value))}`)
  }
  // The marker comment silences ddev's "custom configuration detected" warning.
  const marker = '#ddev-silent-no-warn\n'
  mkdirSync(join(checkoutDir, '.ddev'), { recursive: true })
  writeFileSync(join(checkoutDir, '.ddev', 'config.quickddevpreviews.yaml'), marker + stringify(doc))
  writeFileSync(join(checkoutDir, '.ddev', 'docker-compose.quickddevpreviews.yaml'), marker + stringify(composeOverride()))
  writeLowmemDbConfig(checkoutDir, marker)
  return envVars.length
}

// ddev's db image ships a my.cnf sized for one dev machine (1 GB InnoDB pool,
// 100 connections): every db container settles around 500 MB, which is what
// caps how many previews fit on a host. Shrink it.
function writeLowmemDbConfig(checkoutDir: string, marker: string): void {
  const dir = join(checkoutDir, '.ddev', 'mysql')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '00-quickddevpreviews-lowmem.cnf'), `${marker}[mysqld]
innodb-buffer-pool-size = 256M
performance_schema = OFF
max-connections = 30
tmp-table-size = 16M
max-heap-table-size = 16M
key-buffer-size = 8M
`)
}

// The compose override ddev merges into the project's generated stack.
function composeOverride(): Record<string, unknown> {
  return {
    services: {
      web: {
        mem_limit: WEB_MEM_LIMIT,
        pids_limit: WEB_PIDS_LIMIT,
        // Mapping form (not list form): ddev's generated compose declares
        // service networks as a mapping, and compose refuses to merge the two
        // shapes.
        networks: { [INGRESS_NETWORK]: {} },
      },
      db: { mem_limit: DB_MEM_LIMIT },
    },
    networks: {
      [INGRESS_NETWORK]: { external: true },
    },
  }
}

// Build the env-value translator for 'env' urlMode: every occurrence of a
// project ddev host in an env VALUE becomes its per-run preview form. URL
// forms become the full preview origin (scheme + port from the dashboard
// origin); a remaining bare host becomes the bare preview hostname. Longest
// host first, so a host containing another as a suffix is never
// half-translated.
function envUrlTranslator(hosts: DdevHosts, runId: number): (value: string) => string {
  const base = dashboardOrigin()
  if (!base || !hosts.all.length) return v => v
  const origin = new URL(base)
  const mappings = [...hosts.all]
    .sort((a, b) => b.length - a.length)
    .map((host) => {
      const label = host === hosts.primary ? undefined : previewLabel(host)
      return {
        host,
        previewOrigin: `${origin.protocol}//${previewHostname(runId, origin.host, label)}`,
        previewBare: previewHostname(runId, origin.hostname, label),
      }
    })
  return (value: string) => {
    for (const m of mappings) {
      value = value
        .replaceAll(`https://${m.host}`, m.previewOrigin)
        .replaceAll(`http://${m.host}`, m.previewOrigin)
        .replaceAll(m.host, m.previewBare)
    }
    return value
  }
}

// Strip one layer of matching surrounding quotes (standard .env semantics).
function unquote(v: string): string {
  const q = v[0]
  if (v.length >= 2 && (q === '"' || q === '\'') && v[v.length - 1] === q) {
    return v.slice(1, -1)
  }
  return v
}

// ALL hostnames the project's ddev environment serves, read from the repo's
// tracked `.ddev/config.yaml` (NOT our override): the primary `<name>.<tld>`
// plus every additional_hostnames/additional_fqdns entry.
export interface DdevHosts {
  primary: string | null
  all: string[]
}

export function readDdevHosts(checkoutDir: string): DdevHosts {
  try {
    const cfg = parse(readFileSync(join(checkoutDir, '.ddev', 'config.yaml'), 'utf8')) as {
      name?: string
      project_tld?: string
      additional_hostnames?: string[]
      additional_fqdns?: string[]
    }
    if (!cfg?.name) return { primary: null, all: [] }
    const tld = cfg.project_tld || 'ddev.site'
    const primary = `${cfg.name}.${tld}`
    const all = [
      primary,
      ...(cfg.additional_hostnames ?? []).map(h => `${h}.${tld}`),
      ...(cfg.additional_fqdns ?? []),
    ]
    return { primary, all }
  }
  catch {
    return { primary: null, all: [] }
  }
}
