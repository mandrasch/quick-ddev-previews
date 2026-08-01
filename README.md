# quickddevpreviews

A self-hosted service for generating DDEV preview environments. Install it on a
cheap Hetzner Cloud VPS, register with email + password, and (Phase 2) connect
a GitHub App to boot DDEV projects and generate preview URLs.

## Install

On a fresh Ubuntu 24.04 server (as root):

```bash
curl -fsSL <repo-url>/scripts/install.sh | bash
```

The installer auto-derives the domain from the server's public IP via
[sslip.io](https://sslip.io) (e.g. `1-2-3-4.sslip.io`), so no DNS setup is
needed. It installs Docker, clones the repo, writes `.env`, and starts the app
with Caddy TLS.

Then:

1. Make sure ports 80 and 443 are reachable (check your cloud firewall).
2. Open `https://<auto-derived-domain>` and create your admin account.

To use a real domain instead:

```bash
QDP_DOMAIN=previews.example.com bash <(curl -fsSL <repo-url>/scripts/install.sh)
```

## Development

```bash
npm install
cp .env.example .env   # adjust the values
npm run db:migrate
npm run dev
```

## Password reset

If you lose access, run from the server:

```bash
cd /opt/quickddevpreviews
docker compose exec quickddevpreviews npm run reset-password <email>
```

## Tech stack

Nuxt 4 + Nitro, @nuxt/ui, Drizzle ORM + better-sqlite3, nuxt-auth-utils,
Caddy (TLS), Docker Compose.