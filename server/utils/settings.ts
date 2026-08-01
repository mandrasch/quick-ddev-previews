import { eq } from 'drizzle-orm'
import { db } from '../db'
import { settings as settingsTable, type Settings } from '../db/schema'

// Instance-wide settings: a single row (id = 1). Phase 3 introduces the
// lifecycle knobs the runner needs (maxConcurrentRuns). Defaults are written
// lazily on first read so a fresh DB needs no seeding step.

const DEFAULTS: Omit<Settings, 'id'> = {
  maxConcurrentRuns: 2,
  idleStopMinutes: 1440,
  previewRetentionDays: 7,
  archiveRetentionDays: 30,
}

function ensureRow(): Settings {
  const row = db.select().from(settingsTable).where(eq(settingsTable.id, 1)).get()
  if (row) return row
  db.insert(settingsTable).values({ id: 1, ...DEFAULTS }).run()
  return db.select().from(settingsTable).where(eq(settingsTable.id, 1)).get()!
}

export function getSettings(): Settings {
  return ensureRow()
}

export function getMaxConcurrentRuns(): number {
  return getSettings().maxConcurrentRuns
}
