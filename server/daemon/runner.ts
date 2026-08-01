import { eq } from 'drizzle-orm'
import { execa } from 'execa'
import { db } from '../db'
import { runs, type Project } from '../db/schema'
import { writeDdevConfig, readDdevHosts, type EnvVar } from './ddev'
import { prepareRunCheckout } from './git'
import { execInSandbox, ensureIngressNetwork, webContainerName, WEB_PROJECT_DIR } from './sandbox'
import { getInstallationToken } from '../utils/github-app'
import { getMaxConcurrentRuns } from '../utils/settings'
import { getProject } from '../utils/entities'

// The runner: a single linear script per run (no workflow engine). The flow:
//   1. clone the repo branch (shallow, with the GitHub App installation token)
//   2. write the per-run ddev overrides (unique name, env vars translated to
//      preview origins, mem/pids caps, low-mem db config)
//   3. start ddev on the host daemon (containers boot, network wiring)
//   4. run the custom start command in the web container (default: nothing)
//   5. mark previewReady=true and envState='up'
//
// Live log: appended to runs.log as the steps run. Capped at 128 KB so the row
// stays small enough to poll.
const LOG_CAP = 128 * 1024

// In-flight runs: abort controllers keyed by runId, used by cancelRun.
const controllers = new Map<number, AbortController>()

// Runs the CURRENT process is actually executing (controllers.keys()). The
// dispatcher counts these, not every DB row with status 'running': a row left
// 'running' by a killed process (e.g. a container recreate mid-run) must not
// block the queue forever.
const runningRuns = new Set<number>()

function appendLog(runId: number, chunk: string): void {
  if (!chunk) return
  const row = db.select().from(runs).where(eq(runs.id, runId)).get()
  if (!row) return
  const log = (row.log + chunk).slice(-LOG_CAP)
  db.update(runs).set({ log }).where(eq(runs.id, runId)).run()
}

// Start a queued run. Only the dispatcher calls this (capacity guard + claim).
export async function startRun(runId: number, project: Project): Promise<void> {
  const controller = new AbortController()
  controllers.set(runId, controller)
  runningRuns.add(runId)
  const signal = controller.signal

  let log = ''
  const onLog = (line: string) => {
    log += line
    // Throttle: persist every ~4 KB so the UI poll sees progress without
    // hammering SQLite on every byte.
    if (log.length > 4096) {
      const chunk = log
      log = ''
      // Avoid double-append: chunked write replaces, not appends
      const row = db.select().from(runs).where(eq(runs.id, runId)).get()
      if (row) {
        const merged = (row.log + chunk).slice(-LOG_CAP)
        db.update(runs).set({ log: merged }).where(eq(runs.id, runId)).run()
      }
    }
  }

  db.update(runs)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(runs.id, runId))
    .run()

  try {
    const token = await getInstallationToken(project.owner, project.name)

    // 1. Clone the repo branch.
    const checkoutDir = await prepareRunCheckout(project, runId, token, onLog, await getRunBranch(runId, project))

    // 2. Write the per-run ddev overrides.
    const envVars = await getRunEnvVars(runId)
    writeDdevConfig(checkoutDir, envVars, runId)

    // 3. Start ddev on the host daemon. This is where the containers boot.
    //    The ingress network must exist first: the run's compose override
    //    references it as external, and ddev fails the whole start if it's
    //    missing.
    onLog('Starting ddev…\n')
    await ensureIngressNetwork()
    const ddevExit = await runWithLog(runId, ['ddev', 'start', '-y'], onLog, signal)
    if (ddevExit !== 0) {
      throw new Error(`ddev start exited with code ${ddevExit}`)
    }

    // 4. Run the custom start command in the web container, if set.
    const startCommand = await getRunStartCommand(runId)
    if (startCommand) {
      onLog(`Running start command: ${startCommand}\n`)
      const startExit = await runShellInSandbox(runId, startCommand, onLog, signal)
      if (startExit !== 0) {
        throw new Error(`start command exited with code ${startExit}`)
      }
    }

    // 5. Read the preview hosts (all ddev hostnames the project serves) and
    // mark the run ready.
    const hosts = readDdevHosts(checkoutDir)
    const previewHosts = hosts.all.length ? hosts.all : []
    db.update(runs)
      .set({
        status: 'success',
        envState: 'up',
        previewReady: true,
        previewHosts,
        finishedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .run()
    onLog('Preview ready.\n')
    // Flush any remaining buffered log.
    if (log) {
      const row = db.select().from(runs).where(eq(runs.id, runId)).get()
      if (row) {
        const merged = (row.log + log).slice(-LOG_CAP)
        db.update(runs).set({ log: merged }).where(eq(runs.id, runId)).run()
      }
    }
  }
  catch (e) {
    if (signal.aborted) {
      db.update(runs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(eq(runs.id, runId))
        .run()
    }
    else {
      const msg = (e as Error)?.message || String(e)
      appendLog(runId, `\nFailed: ${msg}\n`)
      db.update(runs)
        .set({ status: 'failed', finishedAt: new Date() })
        .where(eq(runs.id, runId))
        .run()
    }
  }
  finally {
    controllers.delete(runId)
    runningRuns.delete(runId)
  }
}

// Cancel an in-flight run. Aborts the AbortController; the runner catches the
// abort and flips the row to 'cancelled'. Does NOT tear down the env (a
// cancel mid-boot leaves the containers to the dispatcher's GC; Phase 3 has
// no idle-stopper, so a half-booted env stays until deleted manually).
export function cancelRun(runId: number): void {
  controllers.get(runId)?.abort()
}

// Run with streamed output to the run log. The first argv element decides
// host-side ddev (`ddev <args>` from the checkout dir) vs in-sandbox exec
// (`docker exec ... <argv>`). execa's cancelSignal carries the abort; reject:
// false means an exit code != 0 resolves instead of rejecting, which lets us
// show the stderr in the run log.
async function runWithLog(
  runId: number,
  command: string[],
  onLog: (line: string) => void,
  signal: AbortSignal,
): Promise<number> {
  const sub = execInSandbox(runId, command, { reject: false, buffer: false, cancelSignal: signal } as never, undefined)
  const capture = (d: Buffer) => onLog(d.toString('utf8'))
  sub.stdout?.on('data', capture)
  sub.stderr?.on('data', capture)
  const r = await sub
  return r.exitCode ?? 1
}

// Run an arbitrary shell command in the web container, streamed to the log.
async function runShellInSandbox(
  runId: number,
  command: string,
  onLog: (line: string) => void,
  signal: AbortSignal,
): Promise<number> {
  const sub = execa('docker', [
    'exec', '-u', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '-w', WEB_PROJECT_DIR,
    webContainerName(runId),
    '/bin/sh', '-c', command,
  ], { reject: false, buffer: false, cancelSignal: signal })
  const capture = (d: Buffer) => onLog(d.toString('utf8'))
  sub.stdout?.on('data', capture)
  sub.stderr?.on('data', capture)
  const r = await sub
  return r.exitCode ?? 1
}

async function getRunBranch(runId: number, project: Project): Promise<string> {
  const row = db.select().from(runs).where(eq(runs.id, runId)).get()
  return row?.branch || project.defaultBranch
}

async function getRunEnvVars(runId: number): Promise<EnvVar[]> {
  const row = db.select().from(runs).where(eq(runs.id, runId)).get()
  return (row?.envVars as EnvVar[]) || []
}

async function getRunStartCommand(runId: number): Promise<string | null> {
  const row = db.select().from(runs).where(eq(runs.id, runId)).get()
  return row?.startCommand || null
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
// The only place runs start. Queued runs claim oldest-first under
// maxConcurrentRuns.

export async function dispatchRuns(): Promise<void> {
  const max = getMaxConcurrentRuns()

  // Reclaim rows the current process isn't executing: a 'running' row whose
  // run died with its process (e.g. a container recreate mid-run) must be
  // marked failed, or it counts as active forever and blocks the queue.
  const stale = db.select().from(runs)
    .where(eq(runs.status, 'running'))
    .all()
    .filter(r => !runningRuns.has(r.id))
  for (const row of stale) {
    db.update(runs)
      .set({ status: 'failed', finishedAt: new Date() })
      .where(eq(runs.id, row.id))
      .run()
  }

  const active = runningRuns.size
  const slots = max - active
  if (slots <= 0) return

  const queued = db.select().from(runs)
    .where(eq(runs.status, 'queued'))
    .all()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, slots)

  for (const run of queued) {
    // Claim the row: claim-first to avoid two ticks racing.
    const claimed = db.update(runs)
      .set({ status: 'running' })
      .where(eq(runs.id, run.id))
      .returning()
      .get()
    if (!claimed || claimed.status !== 'running') continue

    // Re-resolve project (could have been deleted between queue and claim).
    const project = getProject(run.projectId)
    if (!project) {
      db.update(runs).set({ status: 'failed', finishedAt: new Date() }).where(eq(runs.id, run.id)).run()
      continue
    }

    // Fire and forget: the runner owns its own lifecycle.
    void startRun(run.id, project)
  }
}
