#!/usr/bin/env bash
# Install quickddevpreviews on a fresh Ubuntu 24.04 server (amd64 or arm64).
# Idempotent: re-run it to repair or resume a broken install. Run as root:
#
#   curl -fsSL <repo-url>/scripts/install.sh | bash
#
# Interactive: asks how the instance should be reached (sslip.io auto-domain /
# real domain / lvh.me local previews). Non-interactive overrides:
#   QUICKDDEVPREVIEWS_DOMAIN=<domain>   use a real domain (skips the menu)
#   QUICKDDEVPREVIEWS_MODE=sslip|domain|lvhme   force a mode (no TTY: defaults to sslip)
#   QUICKDDEVPREVIEWS_REF=<branch/tag>  testing: checks out that ref
#
# What it does:
#   1. Reserves uid 1000 (the `quickddevpreviews` user): the container runs
#      as uid 1000 and owns the shared state dirs.
#   2. Clones the repo to /opt/quickddevpreviews at the newest release tag.
#   3. Provisions the host: Docker (any current version).
#   4. Writes /opt/quickddevpreviews/.env for the chosen mode.
#   5. Pulls and starts the app + the caddy TLS entry point.
# ── 0. Re-exec from a file ────────────────────────────────────────────────────
# `curl | bash` streams this script to bash's stdin. bash reads it from that
# pipe, and any child process that inherits stdin (git, its credential
# prompts, ddev) can consume the bytes that were the REST of the script,
# ending the install silently. Fix: on first run, slurp stdin into a temp
# file and re-exec bash on it. From then on the script reads from a file, so
# no child can ever touch it. QUICKDDEVPREVIEWS_SELF marks the re-exec'd copy.
if [ "${QUICKDDEVPREVIEWS_SELF:-}" != "1" ]; then
  TMP_SELF="$(mktemp)"
  cat > "$TMP_SELF"
  exec env QUICKDDEVPREVIEWS_SELF=1 bash "$TMP_SELF" "$@"
fi

set -euo pipefail

INSTALL_DIR="/opt/quickddevpreviews"
DATA_DIR="/data/quickddevpreviews/data"
PROJECTS_DIR="/data/quickddevpreviews/projects"
REPO_URL="https://github.com/mandrasch/quick-ddev-previews"

say() { echo "▶ $*"; }
ok()  { echo "✓ $*"; }
die() { echo "✗ $*" >&2; exit 1; }

# ── 0. Guards ─────────────────────────────────────────────────────────────────
[ "$(id -u)" = 0 ] || die "Run as root (the script provisions Docker and system users)"
[ "$(uname -s)" = "Linux" ] || die "This runs on Linux servers only"
if [ -r /etc/os-release ]; then
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || die "This installer targets Ubuntu (found: ${ID:-unknown})"
  [ "${VERSION_ID:-}" = "24.04" ] || echo "⚠ Tested on Ubuntu 24.04, found $VERSION_ID. Continuing anyway."
fi

say "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl >/dev/null

# ── 1. uid 1000 ───────────────────────────────────────────────────────────────
SERVICE_USER="quickddevpreviews"
if id -u "$SERVICE_USER" >/dev/null 2>&1; then
  [ "$(id -u "$SERVICE_USER")" = 1000 ] || die "User '$SERVICE_USER' exists but is not uid 1000"
  ok "User $SERVICE_USER (uid 1000) exists"
elif getent passwd 1000 >/dev/null; then
  die "uid 1000 is taken by '$(getent passwd 1000 | cut -d: -f1)'. This needs uid 1000 (fresh servers have it free); use a clean host or free the uid."
else
  say "Creating user $SERVICE_USER (uid 1000)"
  useradd --uid 1000 --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ── 2. The repo checkout ──────────────────────────────────────────────────────
# git commands run with stdin from /dev/null: this script arrives via
# `curl | bash`, so bash reads the script itself from stdin. git (and its
# subprocesses, e.g. a credential prompt on a private URL) inherits that
# pipe, and reading it would swallow the REST of the script, ending the
# install silently right here.
if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating existing checkout in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --tags origin < /dev/null
else
  say "Cloning $REPO_URL to $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR" < /dev/null
fi

if [ -n "${QUICKDDEVPREVIEWS_REF:-}" ]; then
  TAG="$QUICKDDEVPREVIEWS_REF"
  case "$QUICKDDEVPREVIEWS_REF" in
    v*) IMAGE_TAG="$QUICKDDEVPREVIEWS_REF" ;;
    *) IMAGE_TAG="latest" ;;
  esac
  echo "⚠ QUICKDDEVPREVIEWS_REF=$QUICKDDEVPREVIEWS_REF (testing mode, image tag: $IMAGE_TAG)"
else
  # `|| true`: with set -euo pipefail, an empty tag list makes `grep -v` exit 1
  # (nothing matched), which would kill the install before the fallback below.
  TAG="$(git -C "$INSTALL_DIR" tag --list 'v*.*.*' | grep -v -- - | sort -V | tail -n1 || true)"
  if [ -z "$TAG" ]; then
    TAG="main"
    IMAGE_TAG="latest"
    echo "⚠ No release tag found, using main branch (image tag: latest)"
  else
    IMAGE_TAG="$TAG"
  fi
fi
say "Checking out $TAG"
# A version tag pins an immutable commit; a branch name (main, or a QUICKDDEVPREVIEWS_REF
# branch) must resolve to the REMOTE ref, not a possibly-stale local branch:
# a previous run that edited files in place (e.g. the old placeholder repo
# URL) leaves local commits on main that `git fetch` won't overwrite, and
# `checkout -qf main` would then run an OLD copy of this very script.
case "$TAG" in
  v*)
    git -C "$INSTALL_DIR" checkout -qf "$TAG" < /dev/null
    ;;
  *)
    git -C "$INSTALL_DIR" fetch origin "$TAG" < /dev/null
    git -C "$INSTALL_DIR" reset --hard "origin/$TAG" < /dev/null
    ;;
esac

# ── 3. Provision the host ─────────────────────────────────────────────────────
# Phase 1: Docker only. Phase 2 will add the ddev CLI + image warm-up.
bash "$INSTALL_DIR/scripts/provision-host.sh" < /dev/null

say "Creating $DATA_DIR"
mkdir -p "$DATA_DIR/.ddev"
chown -R 1000:1000 "$DATA_DIR"
mkdir -p "$PROJECTS_DIR"
chown -R 1000:1000 "$PROJECTS_DIR"

# ── 4. .env ───────────────────────────────────────────────────────────────────
# Three deployment modes, chosen interactively (or via QUICKDDEVPREVIEWS_DOMAIN / QUICKDDEVPREVIEWS_MODE):
#   1) sslip.io auto-domain   zero DNS, for a VPS with a public IP   (default)
#   2) a real domain          the user points DNS records at the box
#   3) lvh.me                 local previews on a Mac/Lima VM (internal TLS)
if [ -f "$INSTALL_DIR/.env" ]; then
  ok ".env exists, keeping it"
else
  # A real domain given via env skips the menu (non-interactive installs).
  DOMAIN="${QUICKDDEVPREVIEWS_DOMAIN:-}"
  if [ -n "$DOMAIN" ]; then
    MODE="domain"
  elif [ -n "${QUICKDDEVPREVIEWS_MODE:-}" ]; then
    MODE="$QUICKDDEVPREVIEWS_MODE"
  elif [ -e /dev/tty ]; then
    echo
    echo "How do you want to reach this instance?"
    echo "  1) sslip.io auto-domain (zero DNS; recommended for a VPS) [default]"
    echo "  2) A real domain you own (e.g. previews.example.com)"
    echo "  3) lvh.me (local previews on a Mac/Lima VM; internal TLS)"
    printf "Choose [1/2/3], Enter for default: "
    read -r CHOICE < /dev/tty
    case "${CHOICE:-1}" in
      2) MODE="domain" ;;
      3) MODE="lvhme" ;;
      *) MODE="sslip" ;;
    esac
  else
    # No TTY (e.g. CI): fall back to the zero-DNS default.
    MODE="sslip"
  fi

  case "$MODE" in
    domain)
      [ -n "$DOMAIN" ] || {
        printf "Domain for this instance (e.g. previews.example.com): "
        read -r DOMAIN < /dev/tty
      }
      [ -n "$DOMAIN" ] || die "A domain is required"
      ;;
    lvhme)
      DOMAIN="lvh.me"
      # Let's Encrypt cannot issue for a local domain; use Caddy's internal CA.
      # The stock Caddyfile (Let's Encrypt) is restored by a fresh install in
      # another mode.
      cp "$INSTALL_DIR/Caddyfile.lvhme" "$INSTALL_DIR/Caddyfile"
      say "Using Caddy internal TLS for $DOMAIN (browser shows a certificate warning)"
      ;;
    *)
      # Auto-derive the domain from the public IP via sslip.io (1.2.3.4 ->
      # 1-2-3-4.sslip.io).
      say "Auto-deriving domain from public IP"
      IP="$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || true)"
      if [ -n "$IP" ]; then
        DASHED_IP="$(echo "$IP" | tr . -)"
        DOMAIN="${DASHED_IP}.sslip.io"
        ok "Derived domain: $DOMAIN"
      else
        die "Could not determine public IP. Set QUICKDDEVPREVIEWS_DOMAIN=<your-domain> and re-run."
      fi
      ;;
  esac
  [ -n "$DOMAIN" ] || die "A domain is required"

  say "Writing $INSTALL_DIR/.env"
  cat > "$INSTALL_DIR/.env" <<EOF
# Written by scripts/install.sh. Keys are documented in .env.example.
QUICKDDEVPREVIEWS_BASE_DOMAIN=$DOMAIN
NUXT_SESSION_COOKIE_DOMAIN=$DOMAIN
NUXT_SESSION_PASSWORD=$(openssl rand -base64 32)
QUICKDDEVPREVIEWS_DATA_DIR=$DATA_DIR
QUICKDDEVPREVIEWS_DB_PATH=$DATA_DIR/quickddevpreviews.db
QUICKDDEVPREVIEWS_PROJECTS=$PROJECTS_DIR
QUICKDDEVPREVIEWS_INSTALL_DIR=$INSTALL_DIR
QUICKDDEVPREVIEWS_VERSION=$IMAGE_TAG
DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
COMPOSE_PROFILES=prod
EOF
  chmod 600 "$INSTALL_DIR/.env"
fi

# ── 5. Pull + start ───────────────────────────────────────────────────────────
say "Starting quickddevpreviews"
cd "$INSTALL_DIR"
# Pull the published release image; if none is published yet (no release tag /
# no CI pipeline), build from the local checkout instead.
if ! docker compose pull -q; then
  say "No published image found; building from source"
  docker compose up -d --build
else
  docker compose up -d
fi

DOMAIN="$(grep '^QUICKDDEVPREVIEWS_BASE_DOMAIN=' "$INSTALL_DIR/.env" | cut -d= -f2)"
IP="$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || echo '<server-ip>')"
echo
ok "quickddevpreviews is running."
echo
echo "Next steps:"
if [ "$DOMAIN" = "lvh.me" ]; then
  echo "  1. Open https://lvh.me in your browser and create your admin account."
  echo "  2. Accept the certificate warning once (Caddy's internal CA)."
  echo "  3. Previews are at https://<slug>.preview.lvh.me (also reachable only"
  echo "     from this machine; no ports are opened)."
  echo
  echo "   (The Mac must resolve lvh.me to 127.0.0.1: use Cloudflare/Google"
  echo "    upstream DNS, or a rebind exception for lvh.me.)"
else
  echo "  1. Ports 80 and 443 must be reachable (check your cloud firewall)."
  echo "  2. Open https://$DOMAIN and create your admin account."
  echo "     (DNS: A $DOMAIN -> $IP)"
fi
echo
echo "Useful: docker compose -f $INSTALL_DIR/docker-compose.yml logs -f quickddevpreviews"