import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// The registered users of this instance. First-run setup creates the owner
// (the row with isOwner = true); afterwards the owner can invite more via the
// /settings/users page. Emails are stored lowercased; the single source of
// truth for normalization is server/utils/users.ts.
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),

  // scrypt hash in the format `salt:hash` (both base64), produced by
  // server/utils/passwords.ts. Never read this outside that module.
  passwordHash: text('password_hash').notNull(),

  name: text('name'),
  avatarUrl: text('avatar_url'),

  isOwner: integer('is_owner', { mode: 'boolean' }).notNull().default(false),
  invitedBy: text('invited_by'),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

// Open invitations. The owner creates a row with a random token; the invite
// URL is /setup?invite=<token>. No SMTP: the URL is shown once for the owner
// to share out-of-band. A token is single-use (consumedAt is set on
// redemption); expiresAt defaults to 7 days after creation.
export const invites = sqliteTable('invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  createdBy: text('created_by').notNull(),
  consumedAt: integer('consumed_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Invite = typeof invites.$inferSelect
export type NewInvite = typeof invites.$inferInsert

// The GitHub App that powers repo access (clone, PRs, triggers). A single row
// (id = 1). Created from the UI via the GitHub App manifest flow after the
// owner logged in, so a fresh instance needs no GitHub env vars: GitHub mints
// the app and returns all its credentials at once. Secrets are encrypted at
// rest (server/utils/crypto.ts). Phase 2 scope: repo access only; email/password
// stays the only login.
export const githubApp = sqliteTable('github_app', {
  id: integer('id').primaryKey(), // singleton, always 1

  appId: text('app_id').notNull(),
  slug: text('slug'),
  htmlUrl: text('html_url'),
  clientId: text('client_id').notNull(),

  // Encrypted (AES-256-GCM). Never read these directly: go through
  // server/utils/github-credentials.ts, which decrypts.
  clientSecretEnc: text('client_secret_enc').notNull(),
  privateKeyEnc: text('private_key_enc').notNull(),
  webhookSecretEnc: text('webhook_secret_enc'),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type GithubAppRow = typeof githubApp.$inferSelect
export type NewGithubAppRow = typeof githubApp.$inferInsert
