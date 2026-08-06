import { hostname } from 'node:os'
import { execa, type Options } from 'execa'
import { runSandboxName, runCheckoutDir } from '../utils/storage'

// The env substrate seam: every run is a ddev project on the HOST docker
// daemon (project name quickddevpreviews-run-<id>, containers
// ddev-quickddevpreviews-run-<id>-web and -db), started by the host-side ddev
// CLI. There is no Docker-in-Docker: images are pulled once per host and
// shared by all runs, and a running preview costs one web + one db container
// instead of a nested Docker host. Isolation: project-facing commands exec
// inside the run's web container as this process's (non-root) uid; the docker
// socket and the host ddev CLI stay on the app side of the boundary.
//
// Topology: the web container is attached to the `quickddevpreviews-ingress`
// network; the preview proxy connects to <web>:80 with the project's real
// hostname in the Host header (the ddev web nginx is a catch-all vhost, no
// ddev-router needed; the router is omitted via ddev's global config). The
// shared `ddev_default` network is detached after start so parallel runs
// cannot reach each other.

// Where ddev mounts the project (the run's checkout) inside the web container.
export const WEB_PROJECT_DIR = '/var/www/html'

const INGRESS_NETWORK = 'quickddevpreviews-ingress'

// The name of the run's web container, derived from the ddev project name.
export function webContainerName(runId: number): string {
  return `ddev-${runSandboxName(runId)}-web`
}

// Any of the run's service containers (web, db, extra ddev services).
export function serviceContainerName(runId: number, service: string): string {
  return `ddev-${runSandboxName(runId)}-${service}`
}

// The run's currently running ddev services. Empty when the stack is stopped
// or gone.
export async function listRunServices(runId: number): Promise<string[]> {
  try {
    const { stdout } = await execa('docker', [
      'ps', '--filter', `label=com.ddev.site-name=${runSandboxName(runId)}`,
      '--format', '{{.Label "com.docker.compose.service"}}',
    ])
    const services = [...new Set(stdout.split('\n').map(s => s.trim()).filter(Boolean))]
    return services.sort((a, b) => (a === 'web' ? -1 : b === 'web' ? 1 : a.localeCompare(b)))
  }
  catch {
    return []
  }
}

// The identity project-facing execs run as inside the WEB container: this
// process's uid, with HOME/USER resolved from the container's passwd (ddev
// bakes a matching user into the web image). Same derivation as EXEC_WRAPPER,
// but host-side, for the SSH command builder.
export async function resolveContainerUser(runId: number): Promise<{ uid: number, gid: number, user: string, home: string }> {
  const uid = process.getuid?.() ?? 1000
  const gid = process.getgid?.() ?? 1000
  try {
    const { stdout } = await execa('docker', ['exec', webContainerName(runId), 'getent', 'passwd', String(uid)])
    const fields = stdout.trim().split(':')
    return { uid, gid, user: fields[0] || 'web', home: fields[5] || '/tmp' }
  }
  catch {
    return { uid, gid, user: 'web', home: '/tmp' }
  }
}

// Start (or resume) the run's ddev stack. `ddev start` is idempotent: a
// stopped project (containers removed, volumes kept) comes back in seconds
// with its DB intact; a running one is reconciled. The ingress network must
// exist before the start: the run's compose override references it as
// external (daemon/ddev.ts).
export async function startEnvStack(runId: number): Promise<void> {
  await ensureIngressNetwork()
  ipCache.delete(runId)
  await execDdev(runId, ['start', '-y'])
  await wireNetworks(runId)
}

export async function envStackRunning(runId: number): Promise<boolean> {
  try {
    const { stdout } = await execa('docker', ['inspect', '-f', '{{.State.Running}}', webContainerName(runId)])
    return stdout.trim() === 'true'
  }
  catch {
    return false
  }
}

// Stop the run's stack: containers are removed, the project's volumes (the
// imported DB) and the checkout survive, so a later start is quick. Name-based,
// so it works even when the checkout is already gone; when ddev doesn't know
// the project (its registry lives in ~/.ddev, which can lag reality), removing
// the labelled containers by hand is equivalent (volumes stay).
export async function stopEnvStack(runId: number): Promise<void> {
  ipCache.delete(runId)
  try {
    await execa('ddev', ['stop', runSandboxName(runId)], { env: DDEV_ENV })
  }
  catch {
    await removeLabelledContainers(runId)
  }
}

// Fully remove the run's environment: containers, volumes, the ddev project
// registration. Best-effort: a missing project/containers is not an error.
export async function removeEnvStack(runId: number): Promise<void> {
  ipCache.delete(runId)
  try {
    await execa('ddev', ['delete', '--omit-snapshot', '-y', runSandboxName(runId)], { env: DDEV_ENV })
  }
  catch {
    // Not a registered project (never started, or already deleted).
  }
  await removeLabelledContainers(runId)
  try {
    const { stdout } = await execa('docker', ['volume', 'ls', '-q', '--filter', `label=com.ddev.site-name=${runSandboxName(runId)}`])
    const volumes = stdout.split('\n').map(v => v.trim()).filter(Boolean)
    if (volumes.length) await execa('docker', ['volume', 'rm', '-f', ...volumes])
  }
  catch {
    // Nothing labelled left.
  }
}

// Force-remove the run's ddev-labelled containers (volumes untouched).
async function removeLabelledContainers(runId: number): Promise<void> {
  try {
    const { stdout } = await execa('docker', ['ps', '-aq', '--filter', `label=com.ddev.site-name=${runSandboxName(runId)}`])
    const ids = stdout.split('\n').map(v => v.trim()).filter(Boolean)
    if (ids.length) await execa('docker', ['rm', '-f', ...ids])
  }
  catch {
    // Nothing to remove.
  }
}

// ddev commands run HOST-side (the CLI drives the host daemon), from the run's
// checkout so ddev resolves the right project.
const DDEV_ENV = { DDEV_NONINTERACTIVE: 'true' } as const

function execDdev(runId: number, args: string[], options?: Options) {
  return execa('ddev', args, {
    cwd: runCheckoutDir(runId),
    ...options,
    env: { ...DDEV_ENV, ...(options?.env as Record<string, string> | undefined) },
  })
}

// `docker exec -u <uid>` does no passwd lookup, so HOME/USER must be derived
// inside the container: the wrapper resolves them from the container's passwd
// (ddev bakes a user matching this process's uid into the web image) and then
// execs the real command with its argv intact.
const EXEC_WRAPPER = 'HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"; [ -n "$HOME" ] || HOME=/tmp; '
  + 'USER="$(id -un 2>/dev/null || echo web)"; export HOME USER; exec "$@"'

// Run a command in the run's environment. Commands starting with `ddev` are
// project-level (start, import-db) and run host-side via the ddev CLI, with
// host paths; everything else execs inside the web container as this
// process's uid (which owns the mounted checkout), in the project dir.
export function execInSandbox(runId: number, command: string[], options?: Options, env?: Record<string, string>) {
  if (command[0] === 'ddev') {
    const child = execDdev(runId, command.slice(1), { ...options, env: { ...(options?.env as Record<string, string> | undefined), ...env } })
    // EVERY `ddev start` re-attaches the shared ddev_default network, so the
    // detach must follow every one.
    if (command[1] === 'start') void child.then(() => wireNetworks(runId), () => {})
    return child
  }
  return execa('docker', [
    'exec', '-u', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '-w', WEB_PROJECT_DIR,
    ...Object.entries(env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    webContainerName(runId),
    '/bin/sh', '-c', EXEC_WRAPPER, 'quickddevpreviews-exec', ...command,
  ], options)
}

// Resolve the address the preview proxy targets: the web container's IP on
// the ingress network. Cached per run; the proxy drops the entry on
// connection errors so a restarted stack re-resolves.
const ipCache = new Map<number, string>()

export async function resolvePreview(runId: number): Promise<string | null> {
  const cached = ipCache.get(runId)
  if (cached) return cached
  try {
    const { stdout } = await execa('docker', [
      'inspect', '-f',
      `{{with index .NetworkSettings.Networks "${INGRESS_NETWORK}"}}{{.IPAddress}}{{end}}`,
      webContainerName(runId),
    ])
    const ip = stdout.trim()
    if (!ip) return null
    ipCache.set(runId, ip)
    return ip
  }
  catch {
    return null
  }
}

export function forgetPreview(runId: number): void {
  ipCache.delete(runId)
}

// Post-start network wiring. The compose override attaches web to the ingress
// network; detaching web and db from the shared `ddev_default` network is
// what keeps parallel runs from reaching each other. Best-effort.
async function wireNetworks(runId: number): Promise<void> {
  const name = runSandboxName(runId)
  for (const container of [webContainerName(runId), `ddev-${name}-db`]) {
    await execa('docker', ['network', 'disconnect', 'ddev_default', container]).catch(() => {})
  }
}

// Make sure the ingress network exists and, when the app itself runs as a
// container, that it is attached, so the proxy can reach web container IPs.
// Must run before ANY `ddev start`: the run's compose override references the
// network as external, so a missing network fails the whole start.
export async function ensureIngressNetwork(): Promise<void> {
  try {
    await execa('docker', ['network', 'create', INGRESS_NETWORK])
  }
  catch {
    // Already exists.
  }
  try {
    await execa('docker', ['network', 'connect', INGRESS_NETWORK, hostname()])
  }
  catch {
    // Already connected, or not running as a container.
  }
}
