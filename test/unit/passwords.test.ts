import { randomBytes } from 'node:crypto'
import { hashScrypt, verifyScrypt } from '../../server/utils/passwords'
import { describe, expect, it } from 'vitest'

describe('passwords', () => {
  it('hashes and verifies a password', () => {
    const password = 'super-secret-123'
    const hash = hashScrypt(password)

    expect(hash).not.toBe(password)
    expect(hash).toContain(':')
    const [salt, hashPart] = hash.split(':')
    expect(salt).toBeTruthy()
    expect(hashPart).toBeTruthy()

    expect(verifyScrypt(password, hash)).toBe(true)
    expect(verifyScrypt('wrong', hash)).toBe(false)
  })

  it('produces different hashes for the same password', () => {
    const password = 'same-password-456'
    const hash1 = hashScrypt(password)
    const hash2 = hashScrypt(password)
    expect(hash1).not.toBe(hash2)
    expect(verifyScrypt(password, hash1)).toBe(true)
    expect(verifyScrypt(password, hash2)).toBe(true)
  })

  it('returns false for a malformed hash', () => {
    expect(verifyScrypt('anything', 'not-a-valid-hash')).toBe(false)
  })

  it('returns false for a hash with only one part', () => {
    expect(verifyScrypt('anything', 'justsalt')).toBe(false)
  })

  it('rejects a hash with wrong output length', () => {
    // A hash where the stored hash part doesn't match what scrypt produced
    const salt = randomBytes(16).toString('base64')
    const wrongHash = Buffer.from('wrong-length').toString('base64')
    const malformed = `${salt}:${wrongHash}`
    expect(verifyScrypt('test', malformed)).toBe(false)
  })
})
