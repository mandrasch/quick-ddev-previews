import { eq } from 'drizzle-orm'
import { db } from '../db'
import { githubApp } from '../db/schema'
import { decrypt, encrypt } from './crypto'

// The single source of GitHub App credentials. They live encrypted in the DB,
// created from the UI via the manifest flow after the owner logged in, so an
// instance needs no GitHub env vars at all. No DB row = not configured.

export interface GithubAppCredentials {
  appId: string
  clientId: string
  clientSecret: string
  privateKey: string
  webhookSecret: string | null
}

export interface SavableGithubApp {
  appId: string | number
  slug?: string | null
  htmlUrl?: string | null
  clientId: string
  clientSecret: string
  privateKey: string
  webhookSecret?: string | null
}

export interface GithubAppInfo {
  appId: string
  slug: string | null
  htmlUrl: string | null
  clientId: string
}

// undefined = not loaded yet, null = loaded and not configured. Credentials never
// change after setup (the flow is single-use), so caching is safe.
let cache: GithubAppCredentials | null | undefined

// The configured credentials, or null when the instance has not been set up.
export function githubAppCredentials(): GithubAppCredentials | null {
  if (cache !== undefined) return cache

  const row = db.select().from(githubApp).where(eq(githubApp.id, 1)).get()
  cache = row
    ? {
        appId: row.appId,
        clientId: row.clientId,
        clientSecret: decrypt(row.clientSecretEnc),
        privateKey: decrypt(row.privateKeyEnc),
        webhookSecret: row.webhookSecretEnc ? decrypt(row.webhookSecretEnc) : null,
      }
    : null
  return cache
}

// Whether the instance has a GitHub App at all (repo access needs app id +
// private key). The setup flow gates on this to decide configured vs. locked.
export function isGithubAppConfigured(): boolean {
  return githubAppCredentials() !== null
}

// Public info for the settings page (no secrets).
export function githubAppInfo(): GithubAppInfo | null {
  const row = db.select().from(githubApp).where(eq(githubApp.id, 1)).get()
  if (!row) return null
  return {
    appId: row.appId,
    slug: row.slug,
    htmlUrl: row.htmlUrl,
    clientId: row.clientId,
  }
}

// Persist the credentials GitHub returned from the manifest conversion. Secrets
// are encrypted here; the row is a singleton (id = 1).
export function saveGithubAppCredentials(app: SavableGithubApp): void {
  db.insert(githubApp)
    .values({
      id: 1,
      appId: String(app.appId),
      slug: app.slug ?? null,
      htmlUrl: app.htmlUrl ?? null,
      clientId: app.clientId,
      clientSecretEnc: encrypt(app.clientSecret),
      privateKeyEnc: encrypt(app.privateKey),
      webhookSecretEnc: app.webhookSecret ? encrypt(app.webhookSecret) : null,
    })
    .run()
  cache = undefined
}

// Remove the GitHub App (the owner disconnects). Secrets vanish with the row.
export function clearGithubAppCredentials(): void {
  db.delete(githubApp).where(eq(githubApp.id, 1)).run()
  cache = undefined
}
