# AGENTS.md

Quick DDEV Previews: a self-hosted service that installs on a cheap Hetzner
Cloud VPS, provides email/password registration, and (Phase 2) connects to
GitHub to boot DDEV projects and generate preview environments.

Reference project: `_reference-project/knecht-cloud/` or check https://github.com/knecht-works/knecht-cloud if the local folder is not available (same tech stack, started with GitHub Auth; we moved that to a second step after registration).

## Writing conventions

- No em-dashes. Ever. Use colons, commas, parentheses, or two sentences instead.
- No AI attribution in commits.
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`,
  `ci:`. Subjects for `feat:`/`fix:` are user-facing prose.
- No comments unless asked, unless the comment explains a non-obvious design
  decision the code alone can't convey.

## Commands

```bash
npm install           # install deps + nuxt prepare
npm run dev           # start dev server (port 3000)
npm run dev:vm        # run the dev server inside the Linux dev VM (port 3333)
npm run build         # production build
npm run lint          # eslint
npm run typecheck     # nuxt typecheck (run after `npm install`)
npm run test          # vitest unit tests
npm run test:e2e      # vitest e2e (needs running instance)
npm run preview:docker # docker compose up -d --build
npm run db:generate   # drizzle-kit generate (after schema changes)
npm run db:migrate    # drizzle-kit migrate
npm run reset-password # password reset CLI (run inside container)
```

Go to http://localhost:3000. First visit shows the setup page.

The installer (`scripts/install.sh`) asks how the instance is reached:
  1) sslip.io auto-domain (zero DNS, VPS)   [default]
  2) a real domain (user DNS records)
  3) lvh.me (local previews on a Mac/Lima VM; swaps in Caddyfile.lvhme with
     Caddy's internal CA, since Let's Encrypt can't issue for 127.0.0.1)
Non-interactive: `QDP_DOMAIN=<domain>` forces mode 2; `QDP_MODE=sslip|domain|
lvhme` forces any; no TTY (CI) defaults to sslip. The session cookie must be
scoped to the base domain (`NUXT_SESSION_COOKIE_DOMAIN`) so the per-run
preview subdomains (`<runId>.preview.<base>`) share it with the dashboard.

DNS note: if a 127.0.0.1-resolving domain like lvh.me doesn't resolve (e.g.
some FritzBox routers block rebinding answers), set the Mac's upstream DNS to
Google (8.8.8.8) or Cloudflare (1.1.1.1), or add a rebind exception.

## Architecture (Phase 1)

```
Caddy (TLS) --reverse_proxy--> quickddevpreviews:3000 (Nitro)
                                     |
                                     +--> SQLite (better-sqlite3, WAL)
                                          /data/quickddevpreviews/data/quickddevpreviews.db
```

- Nuxt 4 + Nitro server, @nuxt/ui (dark theme, lime primary), nuxt-auth-utils
  for the sealed session cookie.
- Drizzle ORM + better-sqlite3. Schema in server/db/schema.ts. Migrations
  auto-applied on boot (server/plugins/migrate.ts).
- scrypt password hashing (no extra native dep).
- AES-256-GCM for secret encryption (Phase 2 GitHub App creds), derived from
  NUXT_SESSION_PASSWORD.
- Docker: one app container + one Caddy container (prod profile).
- sslip.io for zero-DNS setup: the installer auto-derives `<dashed-ip>.sslip.io`
  from the server's public IP.

## Phase 1 scope (done)

- [x] Install on a fresh Ubuntu 24.04 VPS via `scripts/install.sh`
- [x] sslip.io domain auto-derivation (no DNS setup needed)
- [x] Caddy TLS (Let's Encrypt managed cert for the dashboard domain)
- [x] Email + password registration (first user = owner)
- [x] Login / logout (sealed session cookie via nuxt-auth-utils)
- [x] Multi-user invites (owner creates one-time invite URLs, no SMTP)
- [x] Password reset CLI (`scripts/reset-password.mjs`, run inside container)
- [x] Settings page (users list, invite management, GitHub integration)
- [x] System page (version, host, password-reset instructions)
- [x] GitHub App integration (repo access: clone, PRs, triggers)
  - `githubApp` schema table (from reference), AES-256-GCM encrypted at rest
  - Settings page "Create GitHub App" button + GitHub manifest flow
  - Owner-only APIs: manifest, info, disconnect
  - Callback `/setup/github/callback` exchanges code for credentials
  - No GitHub login (email/password stays the only login)

## Phase 3 (done): launch DDEV previews of GitHub projects

- [x] `projects` + `runs` schema (simplified, no workflow engine), migration `0002`
- [x] Launcher UI at `/runs/new`: pick GitHub project (from App installations),
  pick branch, customize start command, set .env values with "Copy .env.example",
  db dump + uploaded-files placeholders (no function yet), "Launch preview" button
- [x] `/api/runs/launch` queues a run (upserts the project row, dispatcher boots it)
- [x] Runner: shallow clone (installation token as HTTP header) -> write ddev
  overrides (unique name `quickddevpreviews-run-<id>`, env translated to preview
  origins, mem/pids caps, low-mem db config) -> `ddev start` -> run the start
  command in the web container -> mark previewReady + envState 'up'
- [x] Dispatcher (concurrency-capped, poke + 10s safety interval) + runs-recover
  plugin (running -> failed on restart)
- [x] Preview pipeline: `shared/utils/preview-host.ts`, `server/middleware/
  preview.ts`, `server/utils/preview-proxy.ts` (env mode), `server/routes/
  tls-ask.get.ts`, Caddyfile on_demand_tls
- [x] Infrastructure: Dockerfile (docker-ce-cli + ddev CLI), docker-compose.yml
  (docker socket + projects dir + ~/.ddev + cookie domain), provision-host.sh
  (ddev install + warm-up), agent-tools plugin (router/ssh-agent omitted)
- [x] UI: `/runs` list, `/runs/[id]` detail (log + KPreviewBrowser), home -> /runs
- [x] Delete run tears down containers + volumes
- [x] Web terminal + SSH into the run
  - In-app terminal (`KRunTerminal.vue` + WebSocket `/api/runs/:id/terminal`,
    dockerode exec, no sshd)
  - Copy-pasteable SSH command (`GET /api/runs/:id/ssh`, `server/utils/ssh.ts`):
    `ssh -t <sshTarget> docker exec ...`. The `sshTarget` setting (owner,
    Settings -> Remote access) is how the operator reaches the host; the
    command runs `docker exec` on the host daemon.
- [x] Launcher start command runs INSIDE the web container after `ddev start`
  (which happens automatically host-side). Default `composer install`; use
  plain container commands (`npm i`, `composer install`), NOT `ddev ...`.

## Phase 4 (next): Hetzner VPS demo install + end-to-end verification

The sslip.io install path is correctly cookie-scoped (verified by code audit):
the installer writes `<dashed-ip>.sslip.io` as `QUICKDDEVPREVIEWS_BASE_DOMAIN`
(scripts/install.sh:184) and now also as `NUXT_SESSION_COOKIE_DOMAIN`
(scripts/install.sh:197); nuxt.config.ts:30 reads the latter with a fallback
to the former. h3 writes that as the `Domain=` attribute of the sealed
`nuxt-session` cookie, which RFC 6265 suffix-matches every subdomain of
`<dashed-ip>.sslip.io`, including `<runId>.preview.<dashed-ip>.sslip.io`. So
the dashboard login carries over to previews (server/utils/preview-proxy.ts:54
gates previews on the same cookie). The per-instance scope is also the only
viable choice: `sslip.io` is on the Public Suffix List, so a `Domain=.sslip.io`
cookie would be rejected by browsers, and bare `.sslip.io` would leak across
unrelated instances. Pre-existing inconsistency fixed in this phase:
docker-compose.yml:19 set `NUXT_SESSION_COOKIE_DOMAIN` but nuxt.config.ts:30
read `QUICKDDEVPREVIEWS_BASE_DOMAIN`; it worked only because .env exposed the
latter via `env_file`. Now nuxt.config accepts both names.

### Provision the demo host

- [ ] Provision a Hetzner Cloud CX22 (amd64) or CAX21 (arm64), Ubuntu 24.04.
- [ ] Run `bash scripts/install.sh` with the default sslip mode; record the
      derived `<dashed-ip>.sslip.io` base printed by the installer.
- [ ] Snapshot the clean install for fast re-provision during testing.

### Manual verification checklist

- [ ] Dashboard `https://<dashed-ip>.sslip.io` loads with a Let's Encrypt cert
      managed by Caddy (NOT an on-demand cert).
- [ ] Register the first user (becomes owner); in Devtools > Application >
      Cookies confirm `nuxt-session` carries `Domain=<dashed-ip>.sslip.io`,
      `Secure`, `HttpOnly`, `SameSite=Lax`. The Domain row is the crux of the
      preview-auth path; if it is host-only, previews will not see the cookie.
- [ ] Settings > Create GitHub App: manifest flow completes and returns to the
      dashboard; the githubApp row is populated.
- [ ] `/runs/new`: pick a project, default `composer install`, launch; the run
      reaches `previewReady`.
- [ ] Open the preview link inside the dashboard iframe: it loads WITHOUT being
      prompted to log in again. This proves the cookie subdomain sharing.
- [ ] Incognito check: open the preview URL in an incognito window -> 302 to
      `https://<dashed-ip>.sslip.io/login`; after logging in, bounce back to
      the original preview URL via the `quickddevpreviews-redirect` cookie
      (server/utils/preview-proxy.ts:66).
- [ ] `/tls-ask?domain=<random-RunId>.preview.<dashed-ip>.sslip.io` returns 404
      unless the run exists AND the host exactly equals
      `previewHostname(runId, base, label)`. Guards against Let's Encrypt
      quota draining via arbitrary subdomains (server/routes/tls-ask.get.ts).
- [ ] Delete the run: its preview host returns 404/redirect and the on-demand
      Caddy cert is left to lapse.

### Brief security check (documented, no code audit pass in this phase)

Authenticated surfaces:
- Dashboard + `/api/**` gated by the sealed `nuxt-session` cookie
  (server/middleware/auth.ts).
- Previews gated by the SAME shared cookie (server/utils/preview-proxy.ts:54),
  with a live membership re-check (server/utils/preview-proxy.ts:77-80) so
  deleted/revoked users are kicked out even with a still-valid cookie.
- preview-proxy removes the `set-cookie` response header after reading the
  session (server/utils/preview-proxy.ts:59): without it, credential-less
  subresource requests would emit an empty domain-scoped session cookie that
  overwrites the operator's live session.

Public surfaces:
- `/tls-ask` is intentionally unauthenticated (Caddy calls it pre-session).
  Protected by run-existence + canonical suffix-equality
  (server/routes/tls-ask.get.ts:19-21): only `<runId>.preview.<THIS base>`
  for an existing run qualifies.

Secrets:
- scrypt password hashing (Node built-in, no native dep).
- `NUXT_SESSION_PASSWORD` seals the session cookie AND derives the AES-256-GCM
  key that encrypts the GitHub App creds at rest (githubApp table).

Isolation:
- Per-instance `<dashed-ip>.sslip.io` cookie scope: no cross-instance leakage,
  and not cookieable from `sslip.io` bare (public suffix).
- preview middleware parses `<id>.preview.` without re-checking the base
  suffix (server/middleware/preview.ts:8); the on-demand TLS ask endpoint
  enforces the suffix first, and the app port is bound to localhost
  (docker-compose.yml), so this is low practical risk.

Residual risks to track (not addressed in this phase):
- No rate limiting on login / invite / tls-ask endpoints.
- Single VPS = no run-to-run isolation beyond Docker: a hostile project's
  start command runs as root inside its own ddev web container.
- Idle-stop / archive / retention is not implemented (see Phase 5), so any
  shared-tester access (Phase 7) must wait on that lifecycle.

## Phase 5 (next): lifecycle, db dump, framework detection, run controls

- [ ] .env-editor which can edit the file anytime, not just on preview instance launch
- [ ] button for git pull, if branch changes
- [ ] vscode-server integration (see knecht-cloud)
- [ ] Idle-stop / archive / restore lifecycle (reapIdleEnvs, retention ladder)
- [ ] DB dump upload + import (`ddev import-db`), shared folders
- [ ] Framework detection chips (typo3/craft/laravel) on the launcher
- [ ] Retry / reboot / cancel buttons on the run page

## Phase 6 (done, one manual step): publish the Docker image via GitHub Actions

The image-publishing pipeline is in place (`ghcr.io/mandrasch/quick-ddev-previews`):

- [x] `.github/workflows/release.yml`: on `push` of tags `v*.*.*`, build the
  `prod` Dockerfile target natively on amd64 + arm64, pass
  `QUICKDDEVPREVIEWS_VERSION=${{ github.ref_name }}`, push
  `ghcr.io/mandrasch/quick-ddev-previews:<tag>-<arch>`, merge to a multi-arch
  manifest under `<tag>` (+ `latest` for stable), create a GitHub Release with
  the conventional-commit changelog (`scripts/changelog-preview.sh`)
- [x] `.github/workflows/test.yml`: lint + typecheck + vitest on push to main
  and pull requests
- [x] `docker-compose.yml` image name:
  `ghcr.io/mandrasch/quick-ddev-previews:${QUICKDDEVPREVIEWS_VERSION:-latest}`
- [ ] Set the GHCR package to **public** after the first release push (or
  anonymous pulls on fresh servers fail)
- [ ] Wire the System page version display to the baked-in
  `QUICKDDEVPREVIEWS_VERSION` (app/pages/system.vue still hardcodes `dev`)

Both workflows skip on doc-only changes (`paths-ignore`: `**.md`, `.gitignore`,
`docs/**`), so editing README.md never triggers CI or an image build. That
filter only applies to branch pushes and PRs: GitHub does not evaluate paths
filters for tag pushes, so a release tag always builds (a tag is explicit
release intent). The installer still builds the app image **from source** on
the server (scripts/install.sh falls back to `docker compose up -d --build`
when `docker compose pull` fails), so a fresh VPS works without any published
image. A stable release tag publishes the multi-arch image, after which fresh
servers pull instead of build.

## Phase 7: Access for testers (UX research needed)

There is research needed to let external testers access projects: Invite them via email? Share a secure link?

Another discussion for this is: Should the runs/previews be numbered like 1.lvh.me, 2.lvh.me - or would a random word string (or user given string) be better for user experience. We need to check solutions like GitHub Codespaces.

## Decisions

- Service name: `quickddevpreviews` (Linux user, container, install dir)
- Env prefix: `QUICKDDEVPREVIEWS_*` (verbose but explicit)
- Password hashing: scrypt (Node built-in, no extra native dep)
- No SMTP in Phase 1: invites are one-time URLs shown to the owner
- Password reset: CLI command inside the container, not email-based
- Lime primary color (carried over from the reference project)
- Settings/invites UI only visible to the owner
- Installer builds from source until a release image is published (GH Actions
  pipeline is a Phase 6 task, see above)