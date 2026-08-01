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

For Phase 3 (DDEV previews): set QUICKDDEVPREVIEWS_BASE_DOMAIN=lvh.me in .env
so the per-run preview subdomains (<runId>.preview.lvh.me) share the session
cookie with the dashboard. Phase 1/Phase 2 do not need it.

FritzBox users: if lvh.me does not resolve (some FritzBox firmware blocks
DNS responses that return 127.0.0.1 as DNS rebinding protection), set the
FritzBox upstream DNS to Google (8.8.8.8) or Cloudflare (1.1.1.1), or add an
exception for lvh.me in the rebind protection settings.

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

## Phase 2 next steps (planned, not started)

- [ ] DDEV project selection + run environments
  - Re-introduce `projects`, `runs`, `workflows`, `triggers` schema
  - Docker socket mount + ddev CLI in the Dockerfile
  - provision-host.sh adds ddev CLI + image warm-up
- [ ] Preview environments with on-demand TLS
  - Caddyfile gains on_demand_tls + https:// catch-all
  - /tls-ask endpoint gates certificate issuance
  - Wildcard sslip.io DNS for *.preview.<base> subdomains

## Decisions

- Service name: `quickddevpreviews` (Linux user, container, install dir)
- Env prefix: `QUICKDDEVPREVIEWS_*` (verbose but explicit)
- Password hashing: scrypt (Node built-in, no extra native dep)
- No SMTP in Phase 1: invites are one-time URLs shown to the owner
- Password reset: CLI command inside the container, not email-based
- Lime primary color (carried over from the reference project)
- Settings/invites UI only visible to the owner