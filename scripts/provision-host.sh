#!/usr/bin/env bash
# Provision a Linux host for quickddevpreviews.
#
# Phase 1: Docker Engine only (stock, no pin).
# Phase 2 will add the ddev CLI + image warm-up (see the reference project's
# provision-host.sh for the full implementation).
#
# Idempotent, safe to re-run.
set -euo pipefail

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

# ── 2. Docker group for the service user ──────────────────────────────────────
SERVICE_USER="quickddevpreviews"
if id -u "$SERVICE_USER" >/dev/null 2>&1; then
  if ! id -nG "$SERVICE_USER" | grep -qw docker; then
    say "Adding $SERVICE_USER to the docker group"
    sudo usermod -aG docker "$SERVICE_USER"
  fi
fi

echo "✓ Host provisioned. Sanity check:"
sudo docker info --format '  docker {{.ServerVersion}}'