#!/usr/bin/env node
// Reset a user's password from the server. Run inside the container:
//
//   docker compose exec quickddevpreviews npm run reset-password <email>
//
// Reads the new password from stdin (hidden) to avoid leaking it into shell
// history. The email comes from argv[2].

import Database from 'better-sqlite3'
import { scryptSync, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

const email = process.argv[2]
if (!email) {
  console.error('Usage: npm run reset-password <email>')
  process.exit(1)
}

const dbPath = process.env.QUICKDDEVPREVIEWS_DB_PATH || '.data/quickddevpreviews.db'
const sqlite = new Database(dbPath)

const normalized = email.trim().toLowerCase()
const row = sqlite.prepare('SELECT id, email FROM users WHERE email = ?').get(normalized)
if (!row) {
  console.error(`No user found with email "${normalized}"`)
  process.exit(1)
}

console.log(`Resetting password for ${row.email}`)
console.log('Enter new password (min 12 chars):')

const rl = createInterface({ input: process.stdin, output: null, terminal: true })
let password = ''
for await (const chunk of process.stdin) {
  password += chunk.toString()
  break
}
rl.close()
password = password.trim()

if (password.length < 12) {
  console.error('Password must be at least 12 characters')
  process.exit(1)
}

const salt = randomBytes(16)
const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
const passwordHash = `${salt.toString('base64')}:${hash.toString('base64')}`

sqlite.prepare('UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ?')
  .run(passwordHash, row.id)

console.log('Password updated successfully')
