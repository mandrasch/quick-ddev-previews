// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({

  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-auth-utils'],

  devtools: { enabled: true },

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  // Scope the session cookie to the base domain so it is also sent to the
  // per-run preview subdomains (Phase 2). Unset = host-only (dev). The CI-built
  // release image builds without the env var; production overrides it at runtime
  // via NUXT_SESSION_COOKIE_DOMAIN (docker-compose.yml derives it from .env).
  runtimeConfig: {
    session: {
      cookie: {
        domain: process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN || undefined,
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },

  // Inside the dev VM the repo is a macOS virtiofs share whose inotify
  // forwarding is unreliable: silently missed events leave the dev server on
  // stale code. scripts/vm-dev.sh sets QUICKDDEVPREVIEWS_DEV_POLLING; then ALL
  // watchers (Nuxt's chokidar, Vite's, and Nitro's) poll instead of trusting
  // inotify.
  watchers: {
    chokidar: {
      usePolling: !!process.env.QUICKDDEVPREVIEWS_DEV_POLLING,
    },
  },

  compatibilityDate: '2025-07-15',

  nitro: {
    watchOptions: {
      usePolling: !!process.env.QUICKDDEVPREVIEWS_DEV_POLLING,
    },
    experimental: {
      websocket: true,
    },
  },

  vite: {
    server: {
      allowedHosts: process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN
        ? [`.${process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN}`]
        : undefined,
      watch: {
        usePolling: !!process.env.QUICKDDEVPREVIEWS_DEV_POLLING,
        interval: 1000,
      },
    },
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },
})
