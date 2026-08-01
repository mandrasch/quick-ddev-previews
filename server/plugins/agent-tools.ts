import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'

// One-time best-effort substrate prep at boot:
//   1. Writes ~/.ddev/global_config.yaml with `omit_containers:
//      [ddev-router, ddev-ssh-agent]` for the app's own user. The router
//      would collide with Caddy on :80/:443; the preview proxy targets each
//      run's web container IP directly, so no router is needed.
//      The provisioned host writes the same config for the `quickddevpreviews`
//      user; here we ensure the app's own user (uid 1000) has it too.
//   2. Creates the projects dir if missing (a fresh host may not have run
//      provision-host.sh's step, or the mount may be absent in dev).

export default defineNitroPlugin(async () => {
  try {
    const ddevDir = join(homedir(), '.ddev')
    const cfg = join(ddevDir, 'global_config.yaml')
    const target = 'omit_containers: [ddev-router, ddev-ssh-agent]\n'
    if (!existsSync(cfg) || !readFileSync(cfg, 'utf8').includes('ddev-router')) {
      if (!existsSync(ddevDir)) await execa('mkdir', ['-p', ddevDir])
      // Append (idempotent): a pre-existing config keeps its other keys.
      writeFileSync(cfg, `${existsSync(cfg) ? readFileSync(cfg, 'utf8') : ''}\n${target}`)
    }
  }
  catch (e) {
    console.warn(`agent-tools: could not write ddev global config: ${(e as Error).message}`)
  }
})
