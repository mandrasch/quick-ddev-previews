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
Non-interactive: `QUICKDDEVPREVIEWS_DOMAIN=<domain>` forces mode 2;
`QUICKDDEVPREVIEWS_MODE=sslip|domain|lvhme` forces any; no TTY (CI) defaults to
sslip. The session cookie must be
scoped to the base domain (`NUXT_SESSION_COOKIE_DOMAIN`) so the per-run
preview subdomains (`<slug>.preview.<base>`) share it with the dashboard.

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
`<dashed-ip>.sslip.io`, including `<slug>.preview.<dashed-ip>.sslip.io`. So
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
  (server/routes/tls-ask.get.ts:19-21): only `<slug>.preview.<THIS base>`
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

## Phase 8: Preview visibility modes + custom subdomains

Two related changes that together answer the Phase 7 question "how do testers
access previews": custom human-readable subdomains and per-run visibility
modes (private default, password-protected, public).

### Custom subdomains (`<slug>.preview.<base>`)

Every preview lives at `<slug>.preview.<base>`: the slug is required, never
optional. The launcher always assigns a random slug (e.g. `tx7k2m9p`); the
owner can switch to a custom human-readable slug (e.g. `myfeature`). There is
no `<runId>.preview` form anymore, so a `public` run with a random slug is
reachable only by its unguessable URL. The `.preview.` infix is kept: it keeps
the slug space disjoint from dashboard routes at bare `<base>`, and the cookie
subdomain scoping (`Domain=<base>`) is unchanged.

Schema (`runs` table):
- `slug text` + unique index `runs_slug_unique` (unique as an INDEX, not a
  column constraint: SQLite can't ALTER TABLE ADD a UNIQUE column). The column
  stays technically nullable because SQLite can't ALTER a column to NOT NULL;
  the migration backfills every legacy row with `run-<id>` and the launch
  endpoint requires a slug, so no NULL row exists in practice.
- Slug rules: `[a-z]` start, `[a-z0-9-]` body, 1-63 chars, no leading/trailing
  hyphen, no `--` (collides with the `<label>--<slug>` separator at
  `preview-host.ts`). Reserved-name blocklist is unnecessary because the
  `.preview.` infix keeps slug space disjoint from app routes.

Code changes (all host knowledge is centralized in
`shared/utils/preview-host.ts` plus one duplicated copy in the `BRIDGE_SCRIPT`
at `preview-proxy.ts:32`):
- `preview-host.ts`: slug-only regex (`[a-z][a-z0-9-]*`). `parsePreviewHost`
  returns `{ slug, label? }`. `previewHostname(slug, base, label?)` takes a
  slug only. `previewKey(run)` is the canonical key for a run row
  (`run.slug ?? 'run-' + run.id`, the fallback mirrors the migration's
  backfill).
- `server/routes/tls-ask.get.ts`: resolve by slug via `getRunBySlug`, then
  require exact canonical equality (previewKey).
- `server/utils/preview-proxy.ts`: resolve the run by `ref.slug`, canonical
  host check via `previewKey`.
- `server/middleware/preview.ts`: passes the parsed ref downstream.
- `server/daemon/ddev.ts`: the env URL translator builds preview origins from
  the run's slug (known at boot).
- `app/components/KPreviewBrowser.vue`: the postMessage origin guard compares
  `ref.slug === props.slug`; the `slug` prop is required.
- Launcher (`server/api/runs/launch.post.ts`): `slug` is a required field.
  Catch `SQLITE_CONSTRAINT_UNIQUE` and reject.
- UI (`app/pages/runs/new.vue`): a "Random link / Custom slug" selector,
  always visible, with a random slug generated on mount. Live availability
  check on the custom slug.

The Caddyfile needs no change: the existing `on_demand_tls` block already
routes every unknown SNI through `tls-ask`, which becomes the sole arbiter
of what gets a cert.

Backward compatibility: the migration backfills existing (Phase 3) runs with
`slug = 'run-' || id`, so they keep working at `run-<id>.preview.<base>`.

### Visibility modes

Today every preview is login-gated (any logged-in admin can view any
preview). This phase adds a per-run `visibility` column with three modes:

- `private` (default): current behavior. Logged-in admins only. No change
  for existing runs.
- `password`: anyone with the run-specific password. The URL (with its
  slug) can be shared freely; the password gates access. Replaces the
  dropped "view users" idea.
- `public`: no gate at all. Anyone with the URL can view. At launch time
  the owner chooses the slug strategy:
  - Auto-generated random slug (e.g. `tx7k2m9p`): the URL itself is the
    secret. This is the "secret link" pattern from the original Phase 7
    discussion, without needing a separate visibility mode.
  - User-chosen custom slug (e.g. `myfeature`): human-readable, truly
    public. Anyone who can guess or discover the slug can view.

Schema (`runs` table):
- `visibility text not null default 'private'` enum of
  `'private' | 'password' | 'public'`.
- `previewPasswordHash text` (nullable; scrypt hash, same scheme as user
  passwords. Present only when `visibility = 'password'`).
- `previewPasswordVersion integer not null default 0` (bumped on password
  change to invalidate existing preview-password cookies).

Gate logic (`server/utils/preview-proxy.ts:53-80`), restructured:

1. Look up the run first (moved up from line 82, needed to read visibility).
2. `private`: current behavior. `getUserSession`, membership re-check,
   bounce to `/login` on no session.
3. `password`:
   - If a valid admin session exists (`nuxt-session` with live membership
     re-check): pass through. Admins skip the password.
   - Else check the preview-password cookie `qdp-preview-pw`
     (`Domain=preview.<base>`, value = `HMAC-SHA256({runId}:{version}:`
     `{expiresAt}, NUXT_SESSION_PASSWORD)`). Verify HMAC, runId match,
     version match, expiry.
   - If cookie valid: pass through. Strip `qdp-preview-pw` from forwarded
     headers so the ddev app never sees it.
   - Else: HTML requests get a password prompt page (served by the proxy,
     not the app); non-HTML get 401.
   - Password form POSTs to `/__qdp_preview_auth__` on the same preview
     host. Proxy verifies password against `previewPasswordHash`, sets
     `qdp-preview-pw` cookie on success, 302-redirects to original URL.
4. `public`: do NOT call `getUserSession` (avoids the empty-cookie-overwrite
   bug at `preview-proxy.ts:55-59`). Skip the session gate entirely. Keep
   the `envState === 'up'` and existence checks.

Password-prompt cookie design:
- Name: `qdp-preview-pw`.
- Domain: `preview.<base>` (NOT `<base>`, so it never reaches the dashboard;
  NOT host-only, so it covers label variants like
  `<label>--<slug>.preview.<base>`).
- Value: HMAC-SHA256 signed token as above. Cannot be forged without
  `NUXT_SESSION_PASSWORD`. A cookie for run A is sent to run B (same
  Domain) but the runId check rejects it -> password prompt.
- `HttpOnly: true`, `SameSite: lax`, `Secure: true`, `Path: /`.
- maxAge: 7 days (configurable). No sliding renewal.
- Distinct from `nuxt-session` (admin cookie); names and domains differ, no
  interference.

Brute-force protection (in-memory, per-run):
- `Map<runId, { count, lockedUntil }>` in the proxy module.
- Lockout after 5 wrong attempts for 60 seconds.
- Lost on restart (acceptable; a DB-persisted counter can wait for a later
  security hardening phase).

Security notes:
- `public` mode: no auth gate. The proxied app serves whatever its start
  command produced to anyone with the URL. Only set `public` on trusted
  runs. Same residual risk as today (any admin can see any run), but wider
  audience.
- `password` mode: the password is the only barrier for non-admins. Use a
  strong password. In-memory rate limiting mitigates brute force but does
  not prevent it entirely; a future phase should add DB-persisted attempt
  tracking and exponential backoff.
- Revocation: change the password -> `previewPasswordVersion` bumps -> all
  existing `qdp-preview-pw` cookies for that run are invalid immediately.

UI changes:
- Launcher (`app/pages/runs/new.vue`): add visibility selector
  (private / password / public), password field (shown when `password` is
  selected), slug field. When visibility is `public`, offer the two slug
  strategies (auto-generated random vs custom).
- Run detail (`app/pages/runs/[id].vue`): show visibility badge, allow
  changing visibility/password post-launch. Show the shareable URL.
- Settings: no changes (visibility is per-run, not global).

## Phase 9: Single-admin role model (follow-up)

The original Feature 3 proposed separating "creators" from "view-only users"
with per-preview grants. This is dropped. All dashboard users are admins:
any logged-in user can create runs, manage settings, invite others, and
connect/disconnect the GitHub App. Per-preview access for non-dashboard
users (testers) is handled entirely by Phase 8's visibility modes (password
/ public), not by dashboard-level roles.

Current state:
- `isOwner` boolean on `users` (`schema.ts:19`). First user gets
  `isOwner = true` at registration (`server/api/_setup/register.post.ts:70`).
- 8 endpoints are owner-only: `PATCH /api/settings`,
  `POST /api/users/invite`, `GET /api/users`, `DELETE /api/users/:id`,
  `DELETE /api/invites/:id`, `GET /api/setup/github/info`,
  `GET /api/setup/github/manifest`, `DELETE /api/setup/github`.
- All run/preview endpoints are already open to every member.
- UI gates: `app/pages/settings.vue` (lines 166, 247, 272) and
  `app/layouts/default.vue:97` ("Owner" / "Member" label).

Changes:
- Remove the `if (!user.isOwner) throw 403` check from the 8 owner-only
  endpoints. All logged-in users can call them.
- Keep `isOwner` as a column (do NOT drop it in a migration). The first-user
  marker is still needed by the setup flow: `hasOwner()`
  (`server/utils/users.ts:35`) determines whether registration is first-run
  (owner claim) or invite-based.
- Update `app/layouts/default.vue:97`: drop the "Owner" / "Member"
  distinction or replace with a generic "Admin".
- Update `app/pages/settings.vue`: remove `v-if="isOwner"` guards on
  GitHub/SSH/users sections (lines 166, 247, 272). All logged-in users see
  them. Keep the per-user "delete" button visible for all users (not just
  owner), but keep the guard that forbids self-deletions and deleting the
  last remaining `isOwner` user.
- `shared/types/auth.d.ts` and `server/utils/users.ts` `SessionUser`: keep
  `isOwner` in the session (the setup flow reads it), but stop using it for
  authorization.

Security implication: any invited user can disconnect the GitHub App,
delete other users, change SSH target, or revoke invites. Acceptable for a
small-team preview tool (the intended use case) but a risk for larger orgs.
The tradeoff is simplicity: no role management UI, no per-user permission
checks. If finer control is ever needed, it can be added later without
changing the Phase 8 visibility model.

## Phase 10: Docs + run controls (planned in a separate session)

- [ ] Clarify in README how VPS users can update the project (see reference
      project `_reference-project/knecht-cloud/` for the update workflow).
      Today the installer is one-shot; operators need documented steps for
      pulling a new image/tag and re-running `docker compose up -d`.

The following run-control features need to be planned in a separate session
(scope, schema impact, and UI placement are not yet decided):

- Better .env editor: edit the run's env vars anytime, not just on preview
  instance launch (today `envVars` is set once at `launch.post.ts` and
  never editable after). Needs a re-apply path that rewrites the ddev
  overrides and restarts the environment.
- Git pull support: a command triggered when a branch is updated, so a run
  can pick up new commits without a full re-launch. Needs a re-run path
  that pulls inside the existing checkout and re-runs the start command.
- Online VS Code IDE: already implemented in the reference project
  (`_reference-project/knecht-cloud/`, code-server in a sidecar container
  per run). Needs the same integration here: a launcher toggle, a sidecar
  container in docker-compose, a route through the preview proxy, and a
  "Open in VS Code" button on the run page.

## Phase 11: Clarify install modes for home / Mac mini hosting

Research finding (from the Mac mini question): the three install modes target
different network situations, and the README/installer copy under-sells the
differences for home servers.

- sslip.io derives `<dashed-ip>.sslip.io` from the server's PUBLIC IP
  (scripts/install.sh:181), so it only works when that IP is static and ports
  80/443 are reachable. Perfect for a VPS; on a home DSL connection it breaks
  the day the ISP rotates the IP (the domain is baked into .env at install
  time, scripts/install.sh:196-197).
- The Mac's LAN IP (192.168.x.x) cannot be used with sslip.io + Let's Encrypt:
  cert issuance fails for private-IP-resolving domains. That is why mode 3
  (lvh.me) exists: 127.0.0.1 + Caddy's internal CA.
- A Mac mini with a STATIC public DSL IP and router port-forwarding is already
  fully covered by mode 1: lima-prod.yaml:33-37 forwards guest 80/443 to
  0.0.0.0 on the Mac, so the router's forward reaches the Lima VM, and Let's
  Encrypt validates because the domain resolves publicly. No new mode needed.
- The only real gap is CGNAT / no public IP: today there is no tunnel path
  (Cloudflare Tunnel / Tailscale). Out of scope unless explicitly requested.

Tasks:

- [ ] Rewrite the "How do you want to reach this instance?" copy in
      scripts/install.sh (lines 143-159) so each mode states its network
      requirement up front (e.g. "static public IP + open ports 80/443").
      Note that mode 1 needs no IP input: the installer auto-derives the
      domain from the public IP via ifconfig.me (scripts/install.sh:181);
      only a failed detection falls back to the
      `QUICKDDEVPREVIEWS_DOMAIN` manual override (scripts/install.sh:187).
- [ ] Update README "Self-host on a Mac (home server)" (README.md:110-148):
      document that a static DSL IP uses mode 1 (sslip.io) with just the port
      forward, a dynamic IP uses mode 2 + dynamic DNS, and local-only uses
      mode 3.
- [ ] Add a decision row to the `## Decisions` section noting that home-server
      hosting needs no fourth mode, and that CGNAT/tunnel setups are
      explicitly unsupported.
- [ ] Optional: installer non-interactive flag to pre-select the mode in the
      lima-prod.yaml one-liner (documented, not required).

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