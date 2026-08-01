import { randomBytes, scryptSync } from 'node:crypto'
import { hashPassword, verifyPassword } from '../../server/utils/passwords'
import { describe, expect, it } from 'vitest'

describe('passwords', () => {
  it('hashes and verifies a password', () => {
    const password = 'super-secret-123'
    const hash = hashPassword(password)

    expect(hash).not.toBe(password)
    expect(hash).toContain(':')
    const [salt, hashPart] = hash.split(':')
    expect(salt).toBeTruthy()
    expect(hashPart).toBeTruthy()

    expect(verifyPassword(password, hash)).toBe(true)
    expect(verifyPassword('wrong', hash)).toBe(false)
  })

  it('produces different hashes for the same password', () => {
    const password = 'same-password-456'
    const hash1 = hashPassword(password)
    const hash2 = hashPassword(password)
    expect(hash1).not.toBe(hash2)
    expect(verifyPassword(password, hash1)).toBe(true)
    expect(verifyPassword(password, hash2)).toBe(true)
  })

  it('returns false for a malformed hash', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false)
  })

  it('returns false for a hash with only one part', () => {
    expect(verifyPassword('anything', 'justsalt')).toBe(false)
  })

  it('rejects a hash with wrong output length', () => {
    // A hash where the stored hash part doesn't match what scrypt produced
    const salt = randomBytes(16).toString('base64')
    const wrongHash = Buffer.from('wrong-length').toString('base64')
    const malformed = `${salt}:${wrongHash}`
    expect(verifyPassword('test', malformed)).toBe(false)
  })
})