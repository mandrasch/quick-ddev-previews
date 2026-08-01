// Pure builders for the run page's remote-access strings. quickddevpreviews
// runs no sshd and manages no keys: it reuses the operator's EXISTING SSH
// access to the host server (the `sshTarget` setting, user@host) and runs
// `docker exec` against the named run container on the host daemon. Every
// interpolated value is charset-checked upstream (settings PATCH) or derived
// (container names, passwd fields), so the command stays one quote-free line
// that survives bash/zsh/fish verbatim.

// The default ssh target: root@<base domain>. Null in dev (no base domain),
// so the run page's SSH command is unavailable until the operator sets it.
export function defaultSshTarget(): string | null {
  const domain = process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN
  return domain ? `root@${domain}` : null
}

// Build the copy-pasteable command: `ssh -t <target> docker exec ...`.
// The web service gets the full identity (uid:gid, workdir, HOME/USER) so a
// login shell lands as the project's own user; other services (db, ...) get a
// plain exec with the container's default user, mirroring `ddev ssh -s <svc>`.
export function sshTerminalCommand(opts: {
  sshTarget: string
  containerName: string
  workdir?: string
  user?: { uid: number, gid: number, user: string, home: string }
}): string {
  const exec = opts.user
    ? `docker exec -it -u ${opts.user.uid}:${opts.user.gid}`
    + (opts.workdir ? ` -w ${opts.workdir}` : '')
    + ` -e HOME=${opts.user.home} -e USER=${opts.user.user} ${opts.containerName} bash -l`
    : `docker exec -it${opts.workdir ? ` -w ${opts.workdir}` : ''} ${opts.containerName} bash`
  return `ssh -t ${opts.sshTarget} ${exec}`
}
