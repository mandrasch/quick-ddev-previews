// The preview-host naming scheme, the ONE place that knows it (used by the
// app's preview links, the host middlewares and the preview proxy):
//
//   [<label>--]<slug>.preview.<base>
//
// Every run has a human-readable slug (the launcher always assigns a random
// one; the owner can pick a custom slug instead). Every hostname a run's ddev
// environment serves gets a per-run preview origin: the primary host as the
// plain `<slug>.` form, each additional one under a label derived from it. The
// slug picks the ddev stack; the label picks the host INSIDE it, so parallel
// runs of the same project coexist without the project's own hostnames ever
// colliding. There is no numeric <runId> form: the slug is the only key, so a
// `public` run with a random slug is reachable only by its unguessable URL.

const PREVIEW_HOST_RE = /^(?:([a-z0-9-]+)--)?([a-z][a-z0-9-]*)\.preview\./

export interface PreviewHostRef {
  /** The run's slug: `myfeature.preview.<base>`. */
  slug: string
  /** Present for an additional (non-primary) hostname's origin. */
  label?: string
}

// Parse an incoming Host (port already stripped) into its run reference, or
// null when it isn't a preview host at all. A slug must start with a letter,
// which keeps the preview namespace free of anything else.
export function parsePreviewHost(host: string): PreviewHostRef | null {
  const match = PREVIEW_HOST_RE.exec(host)
  if (!match) return null
  return { slug: match[2] ?? '', label: match[1] }
}

export function isPreviewHost(host: string): boolean {
  return PREVIEW_HOST_RE.test(host)
}

// The reserved label for a run's web IDE: `<slug>.preview.<base>` serves the
// app, `ide--<slug>.preview.<base>` serves openvscode-server (see
// server/utils/ide-proxy.ts). A project ddev hostname whose previewLabel maps
// to this (e.g. `ide.ddev.site`) loses the collision, which no real hostname
// does in practice (same accepted edge as the reference project).
export const IDE_LABEL = 'ide'

export function isIdeLabel(label: string | undefined): boolean {
  return label === IDE_LABEL
}

// The dashboard's own host, recovered from a preview host (e.g. to send a
// logged-out visitor back to the login page). Ports survive.
export function stripPreviewPrefix(host: string): string {
  return host.replace(PREVIEW_HOST_RE, '')
}

// Build the preview hostname for a run on the given base host (`lvh.me:3333`,
// `preview.example.com`, ...). No label -> the primary host's origin.
export function previewHostname(slug: string, baseHost: string, label?: string): string {
  return `${label ? `${label}--` : ''}${slug}.preview.${baseHost}`
}

// Slug rules (Phase 8): `[a-z]` start, `[a-z0-9-]` body, 1-63 chars, no `--`
// (that separator belongs to the `<label>--<slug>` form).
export function isValidSlug(slug: string): boolean {
  return (
    /^[a-z][a-z0-9-]*$/.test(slug)
    && slug.length >= 1
    && slug.length <= 63
    && !slug.endsWith('-')
    && !slug.includes('--')
  )
}

// The canonical host key for a run row. Every run has a slug (the launcher
// requires one and the migration backfills legacy rows), so the fallback is
// purely defensive and mirrors the migration's backfill format.
export function previewKey(run: { id: number, slug: string | null }): string {
  return run.slug ?? `run-${run.id}`
}

// The label for one of the project's ddev hostnames: the default `.ddev.site`
// suffix is dropped, remaining dots become dashes (they'd end the DNS label).
// `subdomain-a.my-project.ddev.site` -> `subdomain-a-my-project`. Reverse lookup
// compares against the project's host set, never by parsing the label back.
export function previewLabel(ddevHost: string): string {
  return ddevHost.replace(/\.ddev\.site$/, '').replaceAll('.', '-')
}
