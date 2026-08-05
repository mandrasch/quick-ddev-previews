#!/usr/bin/env bash
# Provision a Linux host for quickddevpreviews.
#
#   1. Docker Engine (any current version; no pin, no special runtime)
#   2. the ddev CLI, pinned (it boots the per-run envs on the host daemon)
#   3. the fixed projects dir + docker group for the invoking user
#   4. ddev global config: router + ssh-agent omitted (the preview proxy
#      targets each run's web container directly; a router would collide
#      with Caddy on :80/:443)
#   5. warm-up: a throwaway ddev project pulls the web/db images once per
#      host (all runs share them) and seeds ddev's global cache volume
#
# Idempotent, safe to re-run.
set -euo pipefail

DDEV_VERSION="1.25.2"
PROJECTS_DIR="${QUICKDDEVPREVIEWS_PROJECTS:-/data/quickddevpreviews/projects}"
SERVICE_USER="quickddevpreviews"

say() { echo "▶ $*"; }
ok()  { echo "✓ $*"; }

# ── 1. Docker ─────────────────────────────────────────────────────────────────
if command -v docker >/dev/null; then
  ok "Docker already installed ($(docker --version))"
else
  say "Installing Docker"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# ── 2. ddev CLI, pinned ───────────────────────────────────────────────────────
# Runs are only as reproducible as this version, and the warmed image cache
# must match it. Keep DDEV_VERSION in step with the Dockerfile; bump both
# deliberately, then re-provision so the cache follows.
if ddev --version 2>/dev/null | grep -q "$DDEV_VERSION"; then
  ok "ddev $DDEV_VERSION already installed"
else
  say "Installing ddev $DDEV_VERSION"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://pkg.ddev.com/apt/gpg.key | sudo gpg --dearmor --yes -o /etc/apt/keyrings/ddev.gpg
  echo "deb [signed-by=/etc/apt/keyrings/ddev.gpg] https://pkg.ddev.com/apt/ * *" \
    | sudo tee /etc/apt/sources.list.d/ddev.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq "ddev=${DDEV_VERSION}" || sudo apt-get install -y -qq --allow-downgrades "ddev=${DDEV_VERSION}"
  sudo apt-mark hold ddev
fi

# ── 3. Projects dir + docker group ────────────────────────────────────────────
# The projects dir holds each run's checkout (written by the app at boot). The
# owner depends on who runs the app: on a VPS the app container runs as uid
# 1000 (install.sh reserves it for the service user); in the dev VM the
# invoking user drives the app directly, so the dir must be theirs.
if [ "$(id -u)" = 0 ]; then
  DIR_OWNER="1000:1000"
else
  DIR_OWNER="$(id -u):$(id -g)"
fi
sudo mkdir -p "$PROJECTS_DIR"
sudo chown "$DIR_OWNER" "$PROJECTS_DIR"
if id -u "$SERVICE_USER" >/dev/null 2>&1 && ! id -nG "$SERVICE_USER" | grep -qw docker; then
  say "Adding $SERVICE_USER to the docker group"
  sudo usermod -aG docker "$SERVICE_USER"
fi

# ── 4. ddev global config + warm-up ───────────────────────────────────────────
# ddev refuses to run as root, and install.sh runs this script as root: the
# ddev steps then run as the `quickddevpreviews` user (uid 1000, created by
# install.sh). On the dev VM the script runs as the invoking user directly.
if [ "$(id -u)" = 0 ]; then
  WARM_USER="quickddevpreviews"
  id -u "$WARM_USER" >/dev/null 2>&1 || { echo "User quickddevpreviews missing (install.sh creates it)"; exit 1; }
  usermod -aG docker "$WARM_USER"
  # env -u XDG_CONFIG_HOME: runuser goes through pam_env, which loads
  # /etc/environment; GitHub runners point XDG_CONFIG_HOME at the runner
  # user's home there, and ddev would prefer that (unreadable) path over
  # ~/.ddev for its global config.
  as_warm_user() { runuser -u "$WARM_USER" -- env -u XDG_CONFIG_HOME HOME="$(getent passwd "$WARM_USER" | cut -d: -f6)" DDEV_NONINTERACTIVE=true "$@"; }
else
  WARM_USER="$(id -un)"
  # Dev-VM path: the invoking user drives Docker and ddev directly, so add
  # them to the docker group here (install.sh's root path adds the service
  # user instead). `sg docker` below makes the just-added membership work
  # without re-login.
  if ! id -nG "$WARM_USER" | grep -qw docker; then
    say "Adding $WARM_USER to the docker group"
    sudo usermod -aG docker "$WARM_USER"
    # Lima's guest agent caches group membership per VM boot; sessions only
    # pick the group up after a restart. Remember this for the closing hint.
    WARMUP_REBOOT_HINT=1
  fi
  # `sg docker` so a just-added group membership works without re-login.
  as_warm_user() { sg docker -c "DDEV_NONINTERACTIVE=true $*" 2>/dev/null || env DDEV_NONINTERACTIVE=true "$@"; }
fi
WARM_HOME="$(getent passwd "$WARM_USER" | cut -d: -f6)"

# The global config MUST omit the router before the first start: a router
# would bind host ports 80/443, which belong to Caddy. The containerized app
# writes the same config for its own user at boot (server/plugins/agent-tools.ts).
runuser -u "$WARM_USER" -- mkdir -p "$WARM_HOME/.ddev" 2>/dev/null || mkdir -p "$WARM_HOME/.ddev"
if ! grep -q ddev-router "$WARM_HOME/.ddev/global_config.yaml" 2>/dev/null; then
  printf 'omit_containers: [ddev-router, ddev-ssh-agent]\nperformance_mode: none\ninstrumentation_opt_in: false\n' \
    | runuser -u "$WARM_USER" -- tee -a "$WARM_HOME/.ddev/global_config.yaml" >/dev/null
fi

# ── 5. Warm-up ──────────────────────────────────────────────────────────────
# One throwaway project start pulls the ddev web/db images (shared by every
# run on this host) and initializes the ddev-global-cache volume (mkcert CA
# etc.), whose first-time setup is NOT safe under parallel project starts.
say "Warming the ddev image cache (throwaway project)"
WARMUP="$(mktemp -d)"
# A per-run project name: ddev registers project names globally, so a fixed
# name left behind by a failed or interrupted run makes the next `ddev config`
# refuse. The trap removes the project on ANY exit, so a half-warm run cannot
# poison the next one even if the shell dies mid-way.
WARMUP_NAME="quickddevpreviews-warmup-$$"
mkdir -p "$WARMUP/public"
echo '<?php echo "quickddevpreviews-warmup";' > "$WARMUP/public/index.php"
chown -R "$WARM_USER" "$WARMUP" 2>/dev/null || true

cleanup_warmup() {
  as_warm_user ddev delete --omit-snapshot -y "$WARMUP_NAME" >/dev/null 2>&1 || true
  rm -rf "$WARMUP"
}
trap cleanup_warmup EXIT

(
  cd "$WARMUP"
  as_warm_user ddev config --project-type=php --docroot=public --project-name="$WARMUP_NAME"
  as_warm_user ddev start -y
)

echo "✓ Host provisioned. Sanity check:"
sudo docker info --format '  docker {{.ServerVersion}}'
as_warm_user ddev --version | sed 's/^/  /'

if [ "${WARMUP_REBOOT_HINT:-}" = "1" ]; then
  echo "⚠ New sessions don't see the docker group until the VM is restarted:"
  echo "  limactl restart $(hostname 2>/dev/null || echo '<instance>')"
fi