import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { runs } from '../db/schema'
import { getRun, getProject } from '../utils/entities'
import { getInstallationToken } from '../utils/github-app'
import { runCheckoutDir } from '../utils/storage'
import { appendLog, cancelRun, dispatchRuns, runShellInSandbox } from './runner'
import { readDdevHosts, writeDdevConfig, type EnvVar } from './ddev'
import { branchBehindTip, pullRunBranch } from './git'
import { startEnvStack, stopEnvStack } from './sandbox'

// Post-launch run controls (the run page's Retry / Reboot / Stop / Start /
// Cancel / Pull buttons, and the list page's quick actions). These move a
// run's status (the boot lifecycle) and envState (the environment lifecycle)
// AFTER the runner finished. The boot itself stays owned by the dispatcher and
// runner.

// Cancel an in-flight run: abort the runner for 'running', or flip the row for
// a still-queued one (the dispatcher ignores anything not 'queued'). Throws
// 409 when there is nothing to cancel.
export function cancelRunRequest(runId: number): void {
  const run = getRun(runId)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  if (run.status !== 'queued' && run.status !== 'running') {
    throw createError({ statusCode: 409, statusMessage: 'Nothing to cancel: the run already finished' })
  }
  // Abort the runner: a no-op for a still-queued run, and for a running one the
  // runner flips the row to 'cancelled' when the abort lands.
  cancelRun(runId)
  if (run.status === 'queued') {
    db.update(runs).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(runs.id, runId)).run()
  }
}

// Re-queue a finished run so the dispatcher boots it again. The runner reuses
// the existing checkout, and prepareRunCheckout syncs it to the branch tip
// first (daemon/git.ts), so a retry always starts from a clean tree.
export function retryRun(runId: number): void {
  const run = getRun(runId)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  if (run.status === 'queued' || run.status === 'running') {
    throw createError({ statusCode: 409, statusMessage: 'The run is already active' })
  }
  db.update(runs)
    .set({
      status: 'queued',
      // Take the preview offline until the fresh boot finishes; the runner
      // brings envState back to 'up' on success.
      envState: 'down',
      startedAt: null,
      finishedAt: null,
      previewReady: false,
      previewHosts: [],
    })
    .where(eq(runs.id, runId))
    .run()
  void dispatchRuns()
}

// A run whose env never booted has no stack to start/stop/reboot: those flows
// belong to the launch/retry path. Everything else (up, stopped) is a valid
// target for the env controls.
function requireBootableEnv(run: { status: string, envState: string }): void {
  if (run.status === 'queued' || run.status === 'running') {
    throw createError({ statusCode: 409, statusMessage: 'The run is booting, wait for it to finish' })
  }
  if (run.envState !== 'up' && run.envState !== 'stopped') {
    throw createError({ statusCode: 409, statusMessage: 'The environment has not been booted yet' })
  }
}

// Stop a run's env: containers are removed, the project's volumes (its DB) and
// the checkout survive, so a later start is quick. The preview goes offline.
export async function stopRun(runId: number): Promise<void> {
  const run = getRun(runId)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  requireBootableEnv(run)
  await stopEnvStack(runId)
  db.update(runs).set({ envState: 'stopped' }).where(eq(runs.id, runId)).run()
  appendLog(runId, '\n── Environment stopped ──\n')
}

// Start a stopped run's env again: the kept volumes and checkout boot in
// seconds, the DB state survives.
export async function startEnv(runId: number): Promise<void> {
  const run = getRun(runId)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  requireBootableEnv(run)
  await startEnvStack(runId)
  db.update(runs).set({ envState: 'up' }).where(eq(runs.id, runId)).run()
  appendLog(runId, '\n── Environment started ──\n')
}

// Reboot a run's env: re-apply the CURRENT ddev override (env vars may have
// been edited since launch, see the .env editor) and restart the stack. `ddev
// start` reconciles a running stack and revives a stopped one, so reboot is
// both restart and apply-changes.
export async function rebootRun(runId: number): Promise<void> {
  const run = getRun(runId)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  requireBootableEnv(run)
  const project = getProject(run.projectId)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  const envVars = (run.envVars ?? []) as EnvVar[]
  appendLog(runId, '\n── Rebooting environment ──\n')
  writeDdevConfig(runCheckoutDir(runId), envVars, runId, run.slug ?? `run-${runId}`)
  await startEnvStack(runId)
  db.update(runs).set({ envState: 'up' }).where(eq(runs.id, runId)).run()
  appendLog(runId, 'Environment up.\n')
}

// ── Git pull ────────────────────────────────────────────────────────────────

// Runs with a pull currently in flight: the run page polls this to keep its
// "Pulling…" state and the boot log live.
const pulling = new Set<number>()

export function isPulling(runId: number): boolean {
  return pulling.has(runId)
}

// Background job. Pulls the run's branch into the existing checkout, regenerates
// the ddev override (the new tip may have moved the tracked ddev config),
// reconciles the stack, then re-runs the start command so a dependency change
// (composer.lock etc.) actually lands. Progress streams to the run's boot log,
// which the detail page already polls. POST returns immediately.
export async function pullRun(runId: number): Promise<void> {
  const run = getRun(runId)
  if (!run) return
  const project = getProject(run.projectId)
  if (!project || pulling.has(runId)) return
  pulling.add(runId)
  const onLog = (line: string) => appendLog(runId, line)
  try {
    onLog('\n── Pulling latest changes ──\n')
    const token = await getInstallationToken(project.owner, project.name)
    const result = await pullRunBranch(project, runId, token, run.branch, onLog)
    if (!result.updated) {
      onLog('Already up to date.\n')
      return
    }
    writeDdevConfig(runCheckoutDir(runId), (run.envVars ?? []) as EnvVar[], runId, run.slug ?? `run-${runId}`)
    await startEnvStack(runId)
    if (run.startCommand) {
      onLog(`Running start command: ${run.startCommand}\n`)
      const code = await runShellInSandbox(runId, run.startCommand, onLog, undefined)
      if (code !== 0) throw new Error(`start command exited with code ${code}`)
    }
    // The run's post-pull commands (the "Post-pull commands" editor on the run
    // page), e.g. a build step or cache clear. Run in order, after the start
    // command.
    for (const cmd of run.postPullCommands ?? []) {
      onLog(`Running post-pull command: ${cmd}\n`)
      const code = await runShellInSandbox(runId, cmd, onLog, undefined)
      if (code !== 0) throw new Error(`post-pull command exited with code ${code}`)
    }
    const hosts = readDdevHosts(runCheckoutDir(runId))
    db.update(runs)
      .set({ envState: 'up', previewReady: true, previewHosts: hosts.all })
      .where(eq(runs.id, runId))
      .run()
    onLog('Pull complete.\n')
  }
  catch (e) {
    appendLog(runId, `\nPull failed: ${(e as Error)?.message || String(e)}\n`)
  }
  finally {
    pulling.delete(runId)
  }
}

// Does the run's branch have commits the checkout doesn't? Powers the
// "behind" hint next to the Pull button. Best-effort: an env that never booted
// (no checkout) reports not-behind.
export async function checkRunPullStatus(runId: number): Promise<{ behind: boolean }> {
  const run = getRun(runId)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  const project = getProject(run.projectId)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  const dir = runCheckoutDir(runId)
  if (!existsSync(join(dir, '.git'))) return { behind: false }
  const token = await getInstallationToken(project.owner, project.name)
  return { behind: await branchBehindTip(dir, run.branch, token) }
}
