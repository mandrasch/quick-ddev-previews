import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

// A connected GitHub repository that can be previewed. Picked from the
// GitHub App's installations at launch time; one row per repo. Phase 3
// keeps this lean: the repo identity + what the launch form set. Framework
// detection (typo3/craft/laravel/...) is a Phase 3 stretch goal, not
// needed to boot a preview.
export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),

  // GitHub repo identity (resolves the installation token for clone/fetch).
  githubId: integer('github_id').notNull().unique(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull(),
  defaultBranch: text('default_branch').notNull(),
  private: integer('private', { mode: 'boolean' }).notNull().default(false),
  cloneUrl: text('clone_url').notNull(),

  // The .env.example contents captured at connect time, offered in the
  // launcher as a starting point. Nullable: not every repo has one.
  envExample: text('env_example'),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert

// One preview of a project: a shallow clone + a uniquely-named ddev
// environment on the host daemon. Phase 3 simplifies the reference's run
// row: a single linear script (clone -> ddev start -> start command -> mark
// preview ready). No workflow engine, no runSteps, no triggers/followups.
export const runs = sqliteTable('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),

  // The branch the run checked out.
  branch: text('branch').notNull(),
  // The custom start command (usually: `ddev composer install` etc.).
  // Default is `ddev start` alone if the form leaves it blank.
  startCommand: text('start_command'),
  // Env vars the launcher set, JSON array of { key, value }. These are
  // injected into ddev's web_environment AND translated in the way env-driven
  // projects expect: any ddev-host URL inside a value becomes the per-run
  // preview origin. (Reference: daemon/ddev.ts envUrlTranslator.)
  envVars: text('env_vars', { mode: 'json' })
    .$type<{ key: string, value: string }[]>()
    .notNull()
    .default(sql`'[]'`),

  status: text('status', { enum: ['queued', 'running', 'success', 'failed', 'cancelled'] })
    .notNull()
    .default('queued'),

  // The run's isolated ddev environment state. Phase 3 starts at 'up' on a
  // successful launch and stays there (no idle-stopper/archive yet, that
  // comes with the lifecycle phase).
  envState: text('env_state', { enum: ['down', 'up', 'stopped', 'archived'] })
    .notNull()
    .default('down'),
  // Set once ddev start AND the start command have finished. The UI shows the
  // preview iframe only when this is true and envState is 'up'.
  previewReady: integer('preview_ready', { mode: 'boolean' })
    .notNull()
    .default(false),
  // All hostnames the run's ddev environment serves (primary first). The UI
  // builds the preview host switcher from this list. JSON string array.
  previewHosts: text('preview_hosts', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  previewLastSeen: integer('preview_last_seen', { mode: 'timestamp' }),

  // Live log: appended by the runner as it boots. Capped in the runner.
  log: text('log').notNull().default(''),

  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, table => [
  index('runs_project_id_idx').on(table.projectId),
  index('runs_status_idx').on(table.status),
])

export type Run = typeof runs.$inferSelect
export type NewRun = typeof runs.$inferInsert

// Instance-wide settings: a single row (id = 1). Phase 3 introduces the
// lifecycle knobs preview runs read (concurrency etc.).
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(), // singleton, always 1
  maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(2),
  // Lifecyle columns reserved for the follow-up phase (idle-stop, archive,
  // retention). Phase 3 doesn't read them, but they sit ready so the next
  // migration is only SQL, not schema.
  idleStopMinutes: integer('idle_stop_minutes').notNull().default(1440),
  previewRetentionDays: integer('preview_retention_days').notNull().default(7),
  archiveRetentionDays: integer('archive_retention_days').notNull().default(30),
})

export type Settings = typeof settings.$inferSelect
