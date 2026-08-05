#!/usr/bin/env bash
# Fresh-install smoke test, fully local: a throwaway Lima VM stands in for a
# fresh VPS. Run from the Mac (Lima installed: brew install lima):
#
#   bash scripts/test-install.sh              # tests the currently checked-out branch
#   bash scripts/test-install.sh <ref>        # tests a specific branch or release tag
#
# What it does:
#   1. creates + starts a fresh Ubuntu 24.04 VM (NO mounts, NO forwarded ports:
#      fully isolated, nothing can collide with the Mac or a running dev/prod
#      VM, and it cannot reach into this machine)
#   2. runs THIS checkout's scripts/install.sh inside it, exactly like on a
#      fresh server (QUICKDDEVPREVIEWS_REF picks the branch/tag under test;
#      mode lvhme keeps it deterministic: internal TLS, no Let's Encrypt, no
#      public-IP dependency)
#   3. rebuilds the image so the tested ref's code actually boots (a branch ref
#      would otherwise pull the stale published `latest` image)
#   4. asserts the dashboard answers: fresh DB + migrations applied
#   5. deletes the VM
#
# Honest limits vs a real VPS: there is no public IP, so sslip.io derivation
# and real Let's Encrypt issuance cannot be exercised here (lvhme uses Caddy's
# internal CA). Everything else in install.sh runs for real.
#
# Keep the VM for manual inspection (e.g. open the containers, run the Phase 8
# preview checks by hand) with QUICKDDEVPREVIEWS_TEST_KEEP=1.
set -euo pipefail

VM="${QUICKDDEVPREVIEWS_TEST_VM:-quickddevpreviews-smoke}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Default to the branch you're working on, so `bash scripts/test-install.sh`
# tests exactly the checked-out code. install.sh fetches the ref from origin,
# so a not-yet-pushed branch fails (push first, or pass the ref explicitly).
CURRENT_REF="$(git -C "$ROOT" symbolic-ref --short -q HEAD 2>/dev/null || echo main)"
REF="${1:-${QUICKDDEVPREVIEWS_REF:-$CURRENT_REF}}"

say() { echo "▶ $*"; }
ok()  { echo "✓ $*"; }

# The throwaway VM config: same substrate as scripts/lima-prod.yaml, minus the
# port forwards (the smoke assertions run INSIDE the VM, so no host port is
# needed and no collision is possible).
CONFIG="$(mktemp)"
cat > "$CONFIG" <<'EOF'
vmType: "vz"
cpus: 4
memory: "8GiB"
disk: "40GiB"
mounts: []
minimumLimaVersion: 2.0.0
images:
- location: "https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img"
  arch: "x86_64"
- location: "https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-arm64.img"
  arch: "aarch64"
EOF

cleanup() {
  rm -f "$CONFIG"
  if [ "${QUICKDDEVPREVIEWS_TEST_KEEP:-}" = "1" ]; then
    say "Keeping VM $VM (QUICKDDEVPREVIEWS_TEST_KEEP=1). Inspect with: limactl shell $VM"
  else
    say "Deleting VM $VM"
    limactl delete -f "$VM" 2>/dev/null || true
  fi
}
trap cleanup EXIT

say "Removing any leftover VM named $VM"
limactl delete -f "$VM" 2>/dev/null || true

say "Creating fresh VM $VM"
limactl create --name="$VM" "$CONFIG"
limactl start "$VM"

say "Running install.sh inside the fresh VM (ref: $REF, mode: lvhme)"
# `bash -s <` streams the LOCAL install.sh, exactly like `curl | bash` on a
# VPS; install.sh's stdin re-exec was built for that shape. The script then
# clones the repo at $REF into /opt/quickddevpreviews and provisions the host.
limactl shell "$VM" -- sudo env "QUICKDDEVPREVIEWS_REF=$REF" QUICKDDEVPREVIEWS_MODE=lvhme \
  bash -s < "$ROOT/scripts/install.sh"

say "Rebuilding with the tested ref's code (a branch pull would fetch stale latest)"
limactl shell "$VM" -- sudo bash -c 'cd /opt/quickddevpreviews && docker compose up -d --build'

say "Waiting for the dashboard: fresh DB + migrations + app boot"
limactl shell "$VM" -- sudo bash -c '
  for i in $(seq 1 60); do
    out="$(curl -fsS http://localhost:3000/api/_setup/status 2>/dev/null || true)"
    if [ -n "$out" ]; then
      echo "$out"
      exit 0
    fi
    sleep 5
  done
  echo "dashboard did not answer within 5 minutes" >&2
  docker compose -f /opt/quickddevpreviews/docker-compose.yml logs --tail=50 quickddevpreviews >&2 || true
  exit 1
'

ok "Fresh install smoke test passed (ref: $REF)."
ok "The full stack is up: app on :3000 + Caddy on 80/443 inside the VM."
say "A real VPS is still needed to verify sslip.io + Let's Encrypt (Phase 4 checklist)."
