import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// quickddevpreviews's own data directory (SQLite + uploaded DB dumps, archives).
// Configurable so the container can point it at a persistent volume; defaults
// to a local folder.
export function dataDir(): string {
  return resolve(process.env.QUICKDDEVPREVIEWS_DATA_DIR || '.data')
}

// The fixed project path. When the app runs as a container it MUST be mounted
// byte-identically inside and out (QUICKDDEVPREVIEWS_PROJECTS in compose):
// the HOST daemon resolves the checkout bind mount when a run's ddev stack is
// launched, so the path the app passes has to exist on the host.
// Default: /data/quickddevpreviews/projects.
export function projectsDir(): string {
  return process.env.QUICKDDEVPREVIEWS_PROJECTS || '/data/quickddevpreviews/projects'
}

// A run's isolated working directory (a self-contained shallow clone): its own
// ddev environment boots here.
export function runCheckoutDir(runId: number): string {
  return join(projectsDir(), `run-${runId}`)
}

// The name of a run's environment: its ddev project name on the host daemon
// (containers ddev-quickddevpreviews-run-<id>-web/-db). Everything about a
// run's environment is addressed through this one name.
export function runSandboxName(runId: number): string {
  return `quickddevpreviews-run-${runId}`
}

// Per-project folder for uploaded DB dumps (created on demand). Phase 3 ships
// the UI placeholder only; the dir is here so the route handlers can land.
export function projectDumpDir(projectId: number): string {
  const dir = join(dataDir(), 'dumps', String(projectId))
  mkdirSync(dir, { recursive: true })
  return dir
}

// Strip anything that could escape the dump folder (path traversal, odd chars).
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'dump'
}
