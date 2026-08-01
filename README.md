# quickddevpreviews

A self-hosted service for generating DDEV preview environments. Install it on a
cheap Hetzner Cloud VPS, register with email + password, connect a GitHub App,
and launch live DDEV previews of any branch.

## Fork of Knecht Cloud

This project was heavily inspired by https://github.com/knecht-works/knecht-cloud by the amazingly talented Samuel Reichör.

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
cp .env.example .env   # adjust the values (QUICKDDEVPREVIEWS_BASE_URL is required for the GitHub flow)
npm run db:migrate
npm run dev
```

For DDEV previews set `QUICKDDEVPREVIEWS_BASE_DOMAIN=lvh.me` in `.env` so the
per-run preview subdomains (`<runId>.preview.lvh.me`) share the session cookie
with the dashboard. Previews need a Linux host with Docker + the ddev CLI
(`scripts/provision-host.sh` installs both; the app image ships ddev too).

FritzBox users: if `lvh.me` does not resolve (some FritzBox firmware blocks
DNS responses that return 127.0.0.1 as DNS rebinding protection), set your
laptops DNS to Google (8.8.8.8) or Cloudflare (1.1.1.1), or add an
exception for `lvh.me` in the rebind protection settings in your FritzBox.

## Password reset

If you lose access, run from the server:

```bash
cd /opt/quickddevpreviews
docker compose exec quickddevpreviews npm run reset-password <email>
```

## Tech stack

Nuxt 4 + Nitro, @nuxt/ui, Drizzle ORM + better-sqlite3, nuxt-auth-utils,
Caddy (TLS), Docker Compose.