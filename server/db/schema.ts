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
