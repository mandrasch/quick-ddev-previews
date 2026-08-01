# quickddevpreviews

A self-hosted service for generating DDEV preview environments. Install it on a
cheap Hetzner Cloud VPS, register with email + password, connect a GitHub App,
and launch live DDEV previews of any branch.

## Fork of Knecht Cloud

This project forked some techniques of https://github.com/knecht-works/knecht-cloud, a project made by the amazingly talented Samuel Reichör.

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

## Install on macOS (e.g. a Mac mini)

The run substrate (host Docker + ddev) is Linux-only, so on a Mac the same
setup runs inside a [Lima](https://lima-vm.io) VM. Create the VM from the
checked-in template, then run the installer inside it:

```bash
brew install lima
limactl create --name=quickddevpreviews https://raw.githubusercontent.com/quickddevpreviews/quickddevpreviews/main/scripts/lima-server.yaml
limactl start quickddevpreviews
limactl shell quickddevpreviews
# inside the VM:
curl -fsSL https://raw.githubusercontent.com/quickddevpreviews/quickddevpreviews/main/scripts/install.sh | sudo bash
```

The VM template exposes ports 80 and 443 on all interfaces of the Mac, so the
post-install steps above apply unchanged, with the home-network additions:

1. Forward TCP ports 80 and 443 on your router to the Mac.
2. Point the two DNS records at your public IP. Home connections usually change
   their IP over time, so use a dynamic DNS provider (or a static IP from your
   ISP) and give the Mac a fixed address in your router.

After a macOS reboot, run `limactl start quickddevpreviews`; the containers
inside come back up on their own. Updating and backups work exactly as below,
with `/opt/quickddevpreviews` and `/data/quickddevpreviews` living inside the
VM (`limactl shell quickddevpreviews`).

### Temporary Local Domain Setup on macOS

To just try quickddevpreviews on a Mac, follow the macOS install above and use
`lvh.me` as the domain. It resolves to 127.0.0.1, so the dashboard and all
preview subdomains work without any DNS setup. Ports 80 and 443 on the Mac must
be free.

Let's Encrypt cannot issue certificates for a local domain, so you need to use
Caddy's internal CA instead. Inside the VM, edit `/opt/quickddevpreviews/
Caddyfile` so both site blocks use `tls internal`:

```
{$QUICKDDEVPREVIEWS_BASE_DOMAIN} {
	tls internal
	reverse_proxy quickddevpreviews:3000
}

https:// {
	tls internal {
		on_demand
	}
	reverse_proxy quickddevpreviews:3000
}
```

Restart Caddy with `cd /opt/quickddevpreviews && sudo docker compose restart caddy`.
Open `https://lvh.me`, accept the certificate warning and complete the GitHub
App setup.

> [!TIP]
> GitHub webhooks cannot reach a local instance, so GitHub triggers won't work.

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