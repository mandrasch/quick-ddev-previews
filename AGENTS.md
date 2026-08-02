# AGENTS.md

Quick DDEV Previews: a self-hosted service that installs on a cheap Hetzner
Cloud VPS, provides email/password registration, and (Phase 2) connects to
GitHub to boot DDEV projects and generate preview environments.

Reference project: `_reference-project/knecht-cloud/` (same tech stack, started
with GitHub Auth; we moved that to a second step after registration).

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

## Phase 4 next steps (planned, not started)

- [ ] Idle-stop / archive / restore lifecycle (reapIdleEnvs, retention ladder)
- [ ] DB dump upload + import (`ddev import-db`), shared folders
- [ ] Framework detection chips (typo3/craft/laravel) on the launcher
- [ ] Retry / reboot / cancel buttons on the run page

## Phase 4 next: publish the Docker image via GitHub Actions (done, one manual step)

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

## Phase 5: Access for testers (UX research needed)

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
  pipeline is a Phase 4 task, see above)