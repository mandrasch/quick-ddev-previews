# syntax=docker/dockerfile:1

# ─── quickddevpreviews image ─────────────────────────────────────────────────
# Stages:
#   build    compiles the Nuxt app -> .output (devDeps stay here, never shipped)
#   tooling  shared runtime base: git, docker CLI, ddev CLI, the node user
#   prod     tooling + built app; runs Nitro. The default/shipped image.
#
# This image never runs project stacks: the ddev CLI drives the HOST daemon
# through the mounted socket (one uniquely-named ddev project per run), and
# everything project-facing execs inside the run web containers. See
# AGENTS.md for the architecture.
# ──────────────────────────────────────────────────────────────────────────────

ARG NPM_VERSION=11.9.0
ARG DDEV_VERSION=1.25.2


# ═══ build: compile the Nuxt app ══════════════════════════════════════════════
FROM node:22-bookworm-slim AS build
ARG NPM_VERSION
WORKDIR /app
COPY . .
RUN npm i -g npm@${NPM_VERSION} && npm ci && npm run build


# ═══ tooling: shared runtime base ════════════════════════════════════════════
FROM node:22-bookworm-slim AS tooling
ARG NPM_VERSION
ARG DDEV_VERSION

# 1) Base system dependencies + git + gnupg (dearmors the ddev apt key)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg \
  && install -m 0755 -d /etc/apt/keyrings \
  && rm -rf /var/lib/apt/lists/*

# 2) Docker CLI (client only: there is no daemon in here; it talks to the
#    mounted host socket to boot the per-run ddev stacks).
RUN curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends \
      docker-ce-cli docker-buildx-plugin docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

# 3) ddev CLI, PINNED (runs are only as reproducible as this version; the
#    provisioned host warm-up pulls the matching images, so keep DDEV_VERSION
#    in step with scripts/provision-host.sh). It drives the host daemon
#    through the same mounted socket.
RUN curl -fsSL https://pkg.ddev.com/apt/gpg.key | gpg --dearmor -o /etc/apt/keyrings/ddev.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/ddev.gpg] https://pkg.ddev.com/apt/ * *" \
      > /etc/apt/sources.list.d/ddev.list \
 && apt-get update && apt-get install -y --no-install-recommends "ddev=${DDEV_VERSION}" \
 && rm -rf /var/lib/apt/lists/*

# 4) Pin npm so both dev and prod resolve the lockfile the same way
RUN npm i -g npm@${NPM_VERSION}

# 5) Run as non-root: node's built-in `node` user (uid 1000).
RUN mkdir -p /app && chown node:node /app
USER node

WORKDIR /app


# ═══ prod: built app on Nitro (the shipped image, default target) ═════════════
FROM tooling AS prod
ARG QUICKDDEVPREVIEWS_VERSION=dev
ENV QUICKDDEVPREVIEWS_VERSION=${QUICKDDEVPREVIEWS_VERSION}
COPY --from=build --chown=node:node /app/.output ./.output
# Boot-time migrations (server/plugins/migrate.ts) read this folder from disk.
COPY --from=build --chown=node:node /app/server/db/migrations ./server/db/migrations
# The reset-password CLI script.
COPY --from=build --chown=node:node /app/scripts ./scripts

ENV NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]