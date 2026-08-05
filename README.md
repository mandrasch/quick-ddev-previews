# Quick DDEV previews

A self-hosted service for generating DDEV preview environments. Install it on a Cloud VPS or a MacMini, connect GitHub repositories and launch quick DDEV previews of any branch - which can be shared securely with testers, clients or coworkers.

## 🚧 (Experimental) fork of Knecht Cloud 🚧

This is a fork of https://github.com/knecht-works/knecht-cloud, a project made by the amazingly talented Samuel Reichör.  Significant changes made:

- Added a "create preview" feature, strip other features
- Add support for `sslip.io`, so no external domain required on install
- Registration flow changed to email/password first

> [!WARNING]
> Experimental, use at your own risk. This project is an early preview and proof of concept - no warranties given.

## Demo videos

- [PoC: Quick DDEV previews - on a hetzner VPS](https://www.youtube.com/watch?v=FRNQ9RinErQ) - youtube.com
- [PoC: Quick (selfhosted) DDEV previews - local installation](https://www.youtube.com/watch?v=sS0WUtyXYm4&feature=youtu.be) - youtube.com

## Screenshots

Create preview from any branch:<br>
<img src="screenshot_create_preview.jpg" alt="Create preview from any branch" width="500">

Example of Craft CMS frontend:<br>
<img src="screenshot_craft_frontend.jpg" alt="Example of Craft CMS frontend" width="500">

Example of Craft CMS backend:<br>
<img src="screenshot_craft_backend.jpg" alt="Example of Craft CMS backend" width="500">

Jump into the web or db container and run commands like `php craft up`:<br>
<img src="screenshot_terminal.jpg" alt="Jump into the web or db container" width="500">

## Choose your path

There are two ways to run quickddevpreviews:

- **The installer** (`scripts/install.sh`): builds and runs the packaged app behind Caddy TLS. Use it on a VPS or a Mac at home.
- **The dev VM** (`npm run dev:vm`): runs the source with hot reload, for developing the code. No installer involved.

| I want to... | Go to | Summary |
|---|---|---|
| 1. Selfhost on a VPS | [Install on a VPS](#install-on-a-vps-production) | one-liner installer |
| 2. Selfhost on a Mac (home server) | [Self-host on a Mac](#self-host-on-a-mac-home-server) | Lima VM + installer |
| 3. Develop / test new features | [Develop locally](#develop-locally-build-new-features) | Lima dev VM, source with HMR |

## 1. Install on a VPS (production)

On a fresh Ubuntu 24.04 server, e.g. a Hetzner Cloud VPS CX23, (as root):

> [!WARNING]
> Experimental, use at your own risk. Under active development / early proof of concept. No warranties given.

```bash
curl -fsSL https://raw.githubusercontent.com/mandrasch/quick-ddev-previews/main/scripts/install.sh | bash
```

The installer asks how the instance should be reached:

| Mode | When to use | Example: how the instance is reached |
|---|---|---|
| **1. sslip.io auto-domain** (default) | VPS with a public IP; zero DNS | `123-456-789.sslip.io` |
| **2. Real domain** | you own a domain and can point DNS records at the box | `previews.example.com` |
| **3. lvh.me** | local previews on a Mac/Lima VM; internal TLS | `lvh.me` |

Use option 1, or option 2 if you want to connect a real domain. Option 3 is not possible.

Video: [PoC: Quick DDEV previews - on a hetzner VPS](https://www.youtube.com/watch?v=FRNQ9RinErQ) - youtube.com.

## 2. Self-host on a Mac (home server)

The run substrate (host Docker + ddev) is Linux-only, so on a Mac the same
setup runs inside a [Lima](https://lima-vm.io) VM. 

Create the VM from the prepared lima template, then run the installer inside it:

```bash
brew install lima
limactl create --name=quickddevpreviews https://raw.githubusercontent.com/mandrasch/quick-ddev-previews/main/scripts/lima-prod.yaml
limactl start quickddevpreviews && limactl shell quickddevpreviews
# inside the VM:
curl -fsSL https://raw.githubusercontent.com/mandrasch/quick-ddev-previews/main/scripts/install.sh | sudo bash
```
The installer asks how the instance should be reached:

| Mode | When to use | Example: how the instance is reached |
|---|---|---|
| **1. sslip.io auto-domain** (default) | VPS with a public IP; zero DNS | `123-456-789.sslip.io` |
| **2. Real domain** | you own a domain and can point DNS records at the box | `previews.example.com` |
| **3. lvh.me** | local previews on a Mac/Lima VM; internal TLS | `lvh.me` |

If you want a quick local preview only, choose option 3. `lvh.me` simply resolve to 127.0.0.1.

> [!NOTE]
> The Mac must resolve `lvh.me` to 127.0.0.1. If it doesn't (some routers'
> DNS rebinding protection blocks 127.0.0.1 answers, e.g. FritzBox), set the
> Mac's upstream DNS to Google (8.8.8.8) or Cloudflare (1.1.1.1), or add a
> rebind exception for `lvh.me`.

If instead you want the service publicly reachable, choose mode **1** or **2**
and add the home-network pieces:

1. Forward TCP ports 80 and 443 on your router to the Mac.
2. Point the DNS record at your public IP. Home connections usually change
   their IP over time, so use a dynamic DNS provider (or a static IP from your
   ISP) and give the Mac a fixed address in your router.

After a macOS reboot, run `limactl start quickddevpreviews`; the containers
inside come back up on their own. Updating and backups work exactly as below,
with `/opt/quickddevpreviews` and `/data/quickddevpreviews` living inside the
VM (`limactl shell quickddevpreviews`).

## Develop locally (build new features)

This is for building the code, not for running the installed product (that is
the installer path above). quickddevpreviews needs a Linux host with Docker and
the ddev CLI, so local development runs inside a Lima VM.

### On macOS via the Lima dev VM

```bash
# Prepare the environment (on the Mac)
cp .env.example .env   # adjust the values (see the comments in the file)
```

For the VM flow set these two (the session cookie is scoped to the base
domain, so the dashboard must be reached through it, not through localhost):

```bash
# .env
QUICKDDEVPREVIEWS_BASE_DOMAIN=lvh.me
QUICKDDEVPREVIEWS_BASE_URL=http://lvh.me:3333
```

- `QUICKDDEVPREVIEWS_BASE_DOMAIN=lvh.me` scopes the login cookie to `lvh.me`
  so the preview subdomains (`<runId>.preview.lvh.me`) share it with the
  dashboard.
- `QUICKDDEVPREVIEWS_BASE_URL` is the full origin for server-side links
  (invites, GitHub App callbacks); point it at the dev VM's reachable origin.

Optional: `npm install` on the Mac gives you editor tooling (typecheck, lint).
The dev server itself runs in the VM with its own install, so this is not
required to run the app.

Then create and provision the Linux dev VM (the run substrate, same as a
production VPS), once:

```bash
limactl create --name=quickddevpreviews-dev scripts/lima-dev.yaml
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

Lima auto-forwards the dev server port to the Mac: with
`QUICKDDEVPREVIEWS_BASE_DOMAIN=lvh.me` set, the UI is at
`http://lvh.me:3333` (not `localhost:3333`: the session cookie is scoped to
`lvh.me`, so a `localhost` page never holds the login) and previews at
`http://<runId>.preview.lvh.me:3333`. If `lvh.me` doesn't resolve, see the DNS
note in the [Mac section](#self-host-on-a-mac-home-server) above.

> [!NOTE]
> Running project environments requires a Linux host with Docker and ddev.
> Details on host setup live in `.env.example` and the provisioning scripts
> under `scripts/`.

### Quick loop: test a feature branch

The repo is shared read/write into the VM, so switching branches is a local git
operation and the dev server hot-reloads your changes:

```bash
git switch my-feature   # on the Mac; the VM sees it
npm run dev:vm          # restart after schema or dependency changes
```

- If the branch changed `package.json`, reinstall inside the VM before
  restarting: open a shell (`limactl shell quickddevpreviews-dev`) and run
  `npm ci` in the repo directory.
- New migrations under `server/db/migrations` auto-apply when the dev server
  (re)starts (`server/plugins/migrate.ts`). Regenerate one after editing the
  schema with `npm run db:generate`; wipe the dev DB with `npm run db:reset`.
- Previews are at `http://<runId>.preview.lvh.me:3333`.
- Low on internal disk? Put the VM state on an external drive: set
  `export LIMA_HOME=/Volumes/<HDD>/lima` in `~/.zshrc` **before** creating the
  VM, and the VM disk + Docker/ddev images live there (a spinning HDD is
  slower, an SSD is best). The repo itself stays on the Mac.
- Done for the day: `limactl stop quickddevpreviews-dev`.

### Reinstall the dev VM from scratch (verify recent edits)

```bash
limactl delete -f quickddevpreviews-dev
```

If you want to keep the VM and only reset the database, run `npm run db:reset`
inside it instead; that skips the slowest parts.

### Lima templates at a glance

Both templates create an Ubuntu VM on macOS (the run substrate is Linux-only), but for different purposes:

- `scripts/lima-prod.yaml` (VM `quickddevpreviews`): a production host. You run `install.sh` inside it, exactly like on a VPS. Nothing is shared with the Mac.
- `scripts/lima-dev.yaml` (VM `quickddevpreviews-dev`): a development VM. Your repo checkout is shared read/write into it and the Nuxt dev server runs inside. The installer is not used.


### On a plain Linux host (not tested yet)

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

## Password reset

If you lose access, run from the server:

```bash
cd /opt/quickddevpreviews
docker compose exec quickddevpreviews npm run reset-password <email>
```

## Tech stack

Nuxt 4 + Nitro, @nuxt/ui, Drizzle ORM + better-sqlite3, nuxt-auth-utils,
Caddy (TLS), Docker Compose.