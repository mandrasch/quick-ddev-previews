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

function git(args: string[]) {
  return execa('git', args)
}

function redact(text: string, token: string): string {
  if (!token) return text
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return text.split(token).join('***').split(basic).join('***')
}
