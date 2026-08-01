#!/usr/bin/env bash
# Install quickddevpreviews on a fresh Ubuntu 24.04 server (amd64 or arm64).
# Idempotent: re-run it to repair or resume a broken install. Run as root:
#
#   curl -fsSL <repo-url>/scripts/install.sh | bash
#
# Non-interactive: QDP_DOMAIN=<domain> bash install.sh
#   The installer auto-derives the domain from the server's public IP via
#   sslip.io (e.g. 1-2-3-4.sslip.io). Override with QDP_DOMAIN for a real
#   domain. Testing: QDP_REF=<branch/tag> checks out that ref.
#
# What it does:
#   1. Reserves uid 1000 (the `quickddevpreviews` user): the container runs
#      as uid 1000 and owns the shared state dirs.
#   2. Clones the repo to /opt/quickddevpreviews at the newest release tag.
#   3. Provisions the host: Docker (any current version).
#   4. Writes /opt/quickddevpreviews/.env (domain auto-derived via sslip.io).
#   5. Pulls and starts the app + the caddy TLS entry point.
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
if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating existing checkout in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --tags origin
else
  say "Cloning $REPO_URL to $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

if [ -n "${QDP_REF:-}" ]; then
  TAG="$QDP_REF"
  case "$QDP_REF" in
    v*) IMAGE_TAG="$QDP_REF" ;;
    *) IMAGE_TAG="latest" ;;
  esac
  echo "⚠ QDP_REF=$QDP_REF (testing mode, image tag: $IMAGE_TAG)"
else
  TAG="$(git -C "$INSTALL_DIR" tag --list 'v*.*.*' | grep -v -- - | sort -V | tail -n1)"
  if [ -z "$TAG" ]; then
    TAG="main"
    IMAGE_TAG="latest"
    echo "⚠ No release tag found, using main branch (image tag: latest)"
  else
    IMAGE_TAG="$TAG"
  fi
fi
say "Checking out $TAG"
git -C "$INSTALL_DIR" checkout -qf "$TAG"

# ── 3. Provision the host ─────────────────────────────────────────────────────
# Phase 1: Docker only. Phase 2 will add the ddev CLI + image warm-up.
bash "$INSTALL_DIR/scripts/provision-host.sh" < /dev/null

say "Creating $DATA_DIR"
mkdir -p "$DATA_DIR"
chown -R 1000:1000 "$DATA_DIR"
mkdir -p "$PROJECTS_DIR"
chown -R 1000:1000 "$PROJECTS_DIR"

# ── 4. .env ───────────────────────────────────────────────────────────────────
if [ -f "$INSTALL_DIR/.env" ]; then
  ok ".env exists, keeping it"
else
  # Auto-derive domain from public IP via sslip.io.
  # 1.2.3.4 -> 1-2-3-4.sslip.io
  DOMAIN="${QDP_DOMAIN:-}"
  if [ -z "$DOMAIN" ]; then
    say "Auto-deriving domain from public IP"
    IP="$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || true)"
    if [ -n "$IP" ]; then
      DASHED_IP="$(echo "$IP" | tr . -)"
      DOMAIN="${DASHED_IP}.sslip.io"
      ok "Derived domain: $DOMAIN"
    else
      die "Could not determine public IP. Set QDP_DOMAIN=<your-domain> and re-run."
    fi
  fi
  [ -n "$DOMAIN" ] || die "A domain is required"

  say "Writing $INSTALL_DIR/.env"
  cat > "$INSTALL_DIR/.env" <<EOF
# Written by scripts/install.sh. Keys are documented in .env.example.
QUICKDDEVPREVIEWS_BASE_DOMAIN=$DOMAIN
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
docker compose pull -q
docker compose up -d

DOMAIN="$(grep '^QUICKDDEVPREVIEWS_BASE_DOMAIN=' "$INSTALL_DIR/.env" | cut -d= -f2)"
IP="$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || echo '<server-ip>')"
echo
ok "quickddevpreviews is running."
echo
echo "Next steps:"
echo "  1. Ports 80 and 443 must be reachable (check your cloud firewall)."
echo "  2. Open https://$DOMAIN and create your admin account."
echo
echo "Useful: docker compose -f $INSTALL_DIR/docker-compose.yml logs -f quickddevpreviews"