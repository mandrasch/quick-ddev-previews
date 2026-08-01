# Quick DDEV previews

A self-hosted service for generating DDEV preview environments. Install it on a Cloud VPS, register with email + password, connect a GitHub and launch live DDEV previews of any branch.

## 🚧 (Experimental) fork of Knecht Cloud 🚧

This project forked some techniques of https://github.com/knecht-works/knecht-cloud, a project made by the amazingly talented Samuel Reichör.


> [!WARNING]
> Experimental, use at your own risk. Under active development. No warranties given.

## Install

On a fresh Ubuntu 24.04 server (as root):

```bash
curl -fsSL https://raw.githubusercontent.com/mandrasch/quick-ddev-previews/main/scripts/install.sh | bash
```

The installer auto-derives the domain from the server's public IP via
[sslip.io](https://sslip.io) (e.g. `1-2-3-4.sslip.io`), so no DNS setup is
needed. It installs Docker, clones the repo, writes `.env`, and starts the app
with Caddy TLS.

> **Image builds from source for now.** No release image is published yet, so
> the installer builds the app image on the server from the cloned checkout
> (`docker compose up -d --build`). A published image (via a GitHub Actions
> release pipeline) is planned for later; see AGENTS.md.

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
limactl create --name=quickddevpreviews https://raw.githubusercontent.com/mandrasch/quick-ddev-previews/main/scripts/lima-server.yaml
limactl start quickddevpreviews
limactl shell quickddevpreviews
# inside the VM:
curl -fsSL https://raw.githubusercontent.com/mandrasch/quick-ddev-previews/main/scripts/install.sh | sudo bash
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

### Accessing via localhost only (no ports opened)

The VM template also forwards the app's port 3000 to the Mac's localhost, so
you can use the dashboard without forwarding ports 80/443 on your router. To
switch an installed instance to localhost mode:

```bash
limactl shell quickddevpreviews
# inside the VM:
cd /opt/quickddevpreviews
sed -i '/^QUICKDDEVPREVIEWS_BASE_DOMAIN=/d' .env
sed -i 's|^QUICKDDEVPREVIEWS_BASE_URL=.*|QUICKDDEVPREVIEWS_BASE_URL=http://localhost:3000|' .env
sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' .env
docker compose down && docker compose up -d
exit
```

Then open `http://localhost:3000` in your browser. Caddy is not started in
this mode. To go back to public access, restore `.env.sslipio.bak` (the
installer keeps it) or re-run the installer.

> [!NOTE]
> The GitHub App manifest flow needs a publicly reachable callback URL, so
> connecting GitHub won't work over localhost. Previews still work on the VM.

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

quickddevpreviews needs a Linux host with Docker and the ddev CLI. For local
development there is a Lima VM that provides exactly that.

### On macOS via the Lima dev VM

```bash
# Install dependencies (on the Mac)
npm install

# Prepare the environment
cp .env.example .env   # adjust the values (see the comments in the file)

# Run database migrations
npm run db:migrate
```

Then create and provision the Linux dev VM (the run substrate, same as a
production VPS), once:

```bash
limactl create --name=quickddevpreviews-dev scripts/lima-vm.yaml
limactl start quickddevpreviews-dev
limactl shell quickddevpreviews-dev -- ./scripts/provision-host.sh
```

`provision-host.sh` installs Docker + the pinned ddev CLI, omits the
ddev-router (it would collide with the preview proxy), and warms the shared
image cache.

Start the dev server inside the VM (edit on the Mac as usual; the repo is
mounted into the VM at the identical path):

```bash
npm run dev:vm
```

Lima auto-forwards the dev server port to the Mac: the UI is at
`http://localhost:3333` and previews at `http://<runId>.preview.lvh.me:3333`.

FritzBox users: if `lvh.me` does not resolve (some FritzBox firmware blocks
DNS responses that return 127.0.0.1 as DNS rebinding protection), set your
laptops DNS to Google (8.8.8.8) or Cloudflare (1.1.1.1), or add an
exception for `lvh.me` in the rebind protection settings in your FritzBox.

> [!NOTE]
> Running project environments requires a Linux host with Docker and ddev.
> Details on host setup live in `.env.example` and the provisioning scripts
> under `scripts/`.

### On a plain Linux host

If you already run Linux, skip Lima:

```bash
npm install
cp .env.example .env
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