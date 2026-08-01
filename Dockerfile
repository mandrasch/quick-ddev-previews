# syntax=docker/dockerfile:1

# ─── quickddevpreviews image (Phase 1: auth + install only) ─────────────────
# Stages:
#   build    compiles the Nuxt app -> .output (devDeps stay here, never shipped)
#   tooling  shared runtime base: git, the node user
#   prod     tooling + built app; runs Nitro. The default/shipped image.
#
# Phase 2 will add the docker CLI + ddev CLI to the tooling stage (.for
# driving the host daemon through the mounted socket). Phase 1 has no need.
# ──────────────────────────────────────────────────────────────────────────────

ARG NPM_VERSION=11.9.0


# ═══ build: compile the Nuxt app ══════════════════════════════════════════════
FROM node:22-bookworm-slim AS build
ARG NPM_VERSION
WORKDIR /app
COPY . .
RUN npm i -g npm@${NPM_VERSION} && npm ci && npm run build


# ═══ tooling: shared runtime base ════════════════════════════════════════════
FROM node:22-bookworm-slim AS tooling
ARG NPM_VERSION

# 1) Base system dependencies + git
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git \
  && install -m 0755 -d /etc/apt/keyrings \
  && rm -rf /var/lib/apt/lists/*

# 2) Pin npm so both dev and prod resolve the lockfile the same way
RUN npm i -g npm@${NPM_VERSION}

# 3) Run as non-root: node's built-in `node` user (uid 1000).
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