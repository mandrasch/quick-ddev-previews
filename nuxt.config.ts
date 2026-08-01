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

  compatibilityDate: '2025-07-15',

  vite: {
    server: {
      allowedHosts: process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN
        ? [`.${process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN}`]
        : undefined,
    },
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },
})
