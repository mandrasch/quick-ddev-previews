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
sudo mkdir -p "$PROJECTS_DIR"
sudo chown 1000:1000 "$PROJECTS_DIR"
if id -u "$SERVICE_USER" >/dev/null 2>&1 && ! id -nG "$SERVICE_USER" | grep -qw docker; then
  say "Adding $SERVICE_USER to the docker group"
  sudo usermod -aG docker "$SERVICE_USER"
fi

# ── 4. ddev global config ─────────────────────────────────────────────────────
# ddev refuses to run as root, so ddev steps run as the service user (uid 1000,
# created by install.sh). The global config MUST omit the router before the
# first start: a router would bind host ports 80/443, which belong to Caddy.
WARM_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
if [ -n "$WARM_HOME" ]; then
  sudo -u "$SERVICE_USER" mkdir -p "$WARM_HOME/.ddev"
  if ! grep -q ddev-router "$WARM_HOME/.ddev/global_config.yaml" 2>/dev/null; then
    printf 'omit_containers: [ddev-router, ddev-ssh-agent]\nperformance_mode: none\ninstrumentation_opt_in: false\n' \
      | sudo -u "$SERVICE_USER" tee -a "$WARM_HOME/.ddev/global_config.yaml" >/dev/null
  fi

  # ── 5. Warm-up ──────────────────────────────────────────────────────────────
  # One throwaway project start pulls the ddev web/db images (shared by every
  # run on this host) and initializes the ddev-global-cache volume, whose
  # first-time setup is NOT safe under parallel project starts.
  say "Warming the ddev image cache (throwaway project)"
  WARMUP="$(mktemp -d)"
  mkdir -p "$WARMUP/public"
  echo '<?php echo "quickddevpreviews-warmup";' > "$WARMUP/public/index.php"
  chown -R 1000:1000 "$WARMUP"
  (
    cd "$WARMUP"
    sudo -u "$SERVICE_USER" env -u XDG_CONFIG_HOME HOME="$WARM_HOME" DDEV_NONINTERACTIVE=true \
      ddev config --project-type=php --docroot=public --project-name=quickddevpreviews-warmup
    sudo -u "$SERVICE_USER" env -u XDG_CONFIG_HOME HOME="$WARM_HOME" DDEV_NONINTERACTIVE=true \
      ddev start -y
    sudo -u "$SERVICE_USER" env -u XDG_CONFIG_HOME HOME="$WARM_HOME" DDEV_NONINTERACTIVE=true \
      ddev delete --omit-snapshot -y quickddevpreviews-warmup
  )
  rm -rf "$WARMUP"
fi

echo "✓ Host provisioned. Sanity check:"
sudo docker info --format '  docker {{.ServerVersion}}'
ddev --version | sed 's/^/  /'