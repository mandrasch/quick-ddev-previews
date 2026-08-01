import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'

// One-time substrate prep at boot (idempotent, best-effort): writes the ddev
// global config for THIS process's user (uid 1000, home /home/node, which is
// the ${QUICKDDEVPREVIEWS_DATA_DIR}/.ddev mount). The router and ssh-agent
// are omitted: the preview proxy targets each run's web container directly,
// so no router may bind host ports 80/443 (which belong to Caddy). Also set
// performance_mode none (ddev's mutagen sync is not used) and opt out of
// instrumentation. Without this the first `ddev start` would boot a router
// that collides with Caddy.
export default defineNitroPlugin(() => {
  try {
    const dir = join(homedir(), '.ddev')
    const file = join(dir, 'global_config.yaml')
    mkdirSync(dir, { recursive: true })
    const current = existsSync(file)
      ? (parse(readFileSync(file, 'utf8')) as Record<string, unknown> | null) ?? {}
      : {}
    const merged = { ...current, ...GLOBAL_CONFIG }
    if (JSON.stringify(merged) !== JSON.stringify(current)) {
      writeFileSync(file, stringify(merged))
    }
  }
  catch (e) {
    console.warn(`agent-tools: could not write ddev global config: ${(e as Error).message}`)
  }
})

const GLOBAL_CONFIG: Record<string, unknown> = {
  omit_containers: ['ddev-router', 'ddev-ssh-agent'],
  performance_mode: 'none',
  instrumentation_opt_in: false,
}
