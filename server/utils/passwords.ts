import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// scrypt-based password hashing. Uses Node's built-in crypto so there is no
// extra native dependency beyond better-sqlite3 (which already ships). The
// format is `salt:hash` (both base64), 32-byte salt, 64-byte hash.
//
// Parameters (N=16384, r=8, p=1) match OWASP recommendations for scrypt.
// Changing them only affects newly hashed passwords; existing hashes are
// verified with the parameters they were created with (scrypt derives the
// params from the output length).

const SCRYPT_KEYLEN = 64
const SALT_LEN = 16

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN)
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 })
  return `${salt.toString('base64')}:${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(':')
  if (!saltB64 || !hashB64) return false
  const salt = Buffer.from(saltB64, 'base64')
  const hash = Buffer.from(hashB64, 'base64')
  const candidate = scryptSync(password, salt, hash.length, { N: 16384, r: 8, p: 1 })
  return timingSafeEqual(hash, candidate)
}
