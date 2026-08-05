import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import type { Project } from '../db/schema'
import { runCheckoutDir } from '../utils/storage'

// Prepare an isolated working directory for a run: a self-contained shallow
// clone per run. Self-contained matters: the checkout is bind-mounted into
// the run's web container, and only a real clone (not a worktree, whose
// `.git` pointer would dangle at an unmounted host path) lets plain git work
// inside the sandbox (the web IDE, the terminal). The clone's local git
// config wires it for commits (bot identity).
//
// Auth for HOST-side network operations: a short-lived (1h) GitHub App
// installation token, passed per operation as an HTTP header: NEVER stored in
// the remote URL (it would go stale) and NEVER streamed to the run log; git
// output is captured quietly here and any error is redacted before it
// surfaces.

export async function prepareRunCheckout(
  project: Project,
  runId: number,
  token: string,
  onLog: (line: string) => void,
  branch: string = project.defaultBranch,
): Promise<string> {
  const dir = runCheckoutDir(runId)
  const url = `https://github.com/${project.fullName}.git`

  try {
    if (existsSync(join(dir, '.git'))) {
      onLog(`Reusing checkout at ${dir}\n`)
      // A reused checkout may be stale (a retry, or the feature branch moved):
      // sync the working tree to the branch tip before anything else runs.
      await pullRunBranch(project, runId, token, branch, onLog)
    }
    else {
      mkdirSync(dir, { recursive: true })
      onLog(`Cloning ${project.fullName} (${branch})…\n`)
      await git([...authFlags(token), 'clone', '--depth', '1', '--branch', branch, url, dir])
    }

    shieldGeneratedFiles(dir)
    await configureCheckout(dir)
    return dir
  }
  catch (e) {
    // Redact the token so it can never reach the (UI-visible) run log.
    throw new Error(redact(String((e as Error).message), token), { cause: e })
  }
}

// Wire the clone so plain git works INSIDE the sandbox: commits carry the
// bot identity and a branch created in the IDE pushes without upstream
// ceremony.
async function configureCheckout(dir: string): Promise<void> {
  await git(['-C', dir, 'config', 'user.name', 'quickddevpreviews'])
  await git(['-C', dir, 'config', 'user.email', 'noreply@quickddevpreviews.local'])
  await git(['-C', dir, 'config', 'push.autoSetupRemote', 'true'])
}

// Per-invocation auth for git network ops: the installation token rides in an
// extra HTTP header instead of the remote URL, so nothing long-lived is
// written to disk.
function authFlags(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return ['-c', `http.https://github.com/.extraheader=Authorization: Basic ${basic}`]
}

// quickddevpreviews writes generated files into the checkout: the ddev
// overrides. The ignore patterns go in the clone's `info/exclude`, so the
// generated files can never enter a commit. Idempotent.
function shieldGeneratedFiles(dir: string): void {
  const exclude = join(dir, '.git', 'info', 'exclude')
  const patterns = [
    '/.ddev/config.quickddevpreviews.yaml',
    '/.ddev/docker-compose.quickddevpreviews.yaml',
    '/.ddev/mysql/00-quickddevpreviews-lowmem.cnf',
  ]
  try {
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    const lines = current.split('\n')
    const missing = patterns.filter(p => !lines.includes(p))
    if (!missing.length) return
    appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`)
  }
  catch {
    // Best-effort.
  }
}

// Sync an existing checkout to the remote tip of a branch (the "git pull" of
// a run): shallow-fetch the branch, hard-reset the working tree to it. Returns
// whether the tip actually moved. The generated ddev overrides are git-excluded
// (shieldGeneratedFiles), so a hard reset never touches them. Same auth and
// redaction discipline as prepareRunCheckout.
export interface PullResult {
  updated: boolean
  beforeSha: string
  afterSha: string
}

export async function pullRunBranch(
  project: Project,
  runId: number,
  token: string,
  branch: string,
  onLog: (line: string) => void,
): Promise<PullResult> {
  const dir = runCheckoutDir(runId)
  try {
    const beforeSha = await gitSha(dir, 'HEAD')
    onLog(`Fetching ${project.fullName} (${branch})…\n`)
    await git([...authFlags(token), '-C', dir, 'fetch', '--depth', '1', 'origin', branch])
    const afterSha = await gitSha(dir, `origin/${branch}`)
    if (afterSha === beforeSha) {
      return { updated: false, beforeSha, afterSha }
    }
    onLog(`Pulled ${beforeSha.slice(0, 7)} → ${afterSha.slice(0, 7)}\n`)
    await git(['-C', dir, 'reset', '--hard', `origin/${branch}`])
    return { updated: true, beforeSha, afterSha }
  }
  catch (e) {
    throw new Error(redact(String((e as Error).message), token), { cause: e })
  }
}

// Does the remote tip of `branch` differ from the checkout's current HEAD?
// Shallow-fetches to update the remote-tracking ref first. Best-effort: a
// missing or broken checkout reports "not behind" instead of failing the run
// page.
export async function branchBehindTip(dir: string, branch: string, token: string): Promise<boolean> {
  try {
    await git([...authFlags(token), '-C', dir, 'fetch', '--depth', '1', 'origin', branch])
    return (await gitSha(dir, 'HEAD')) !== (await gitSha(dir, `origin/${branch}`))
  }
  catch {
    return false
  }
}

async function gitSha(dir: string, ref: string): Promise<string> {
  const { stdout } = await execa('git', ['-C', dir, 'rev-parse', ref])
  return stdout.trim()
}

function git(args: string[]) {
  return execa('git', args)
}

function redact(text: string, token: string): string {
  if (!token) return text
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return text.split(token).join('***').split(basic).join('***')
}
