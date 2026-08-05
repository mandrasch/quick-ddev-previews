import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  issuePreviewPasswordToken,
  previewPasswordCookieDomain,
  previewPasswordMaxAgeSec,
  verifyPreviewPasswordToken,
} from '../../server/utils/preview-password'

const ORIGINAL_PW = process.env.NUXT_SESSION_PASSWORD
const ORIGINAL_BASE = process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN

beforeEach(() => {
  process.env.NUXT_SESSION_PASSWORD = 'test-session-password-for-preview-pw-tests-1234'
})
afterEach(() => {
  if (ORIGINAL_PW === undefined) delete process.env.NUXT_SESSION_PASSWORD
  else process.env.NUXT_SESSION_PASSWORD = ORIGINAL_PW
  if (ORIGINAL_BASE === undefined) delete process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN
  else process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN = ORIGINAL_BASE
})

describe('preview-password', () => {
  it('verifies a freshly issued token', () => {
    const token = issuePreviewPasswordToken(7, 1)
    expect(verifyPreviewPasswordToken(token, 7, 1)).toBe(true)
  })

  it('rejects a token for a different run (cookies share Domain=preview.<base>)', () => {
    const token = issuePreviewPasswordToken(7, 1)
    expect(verifyPreviewPasswordToken(token, 8, 1)).toBe(false)
  })

  it('rejects a token with a stale version (password was changed)', () => {
    const token = issuePreviewPasswordToken(7, 1)
    expect(verifyPreviewPasswordToken(token, 7, 2)).toBe(false)
  })

  it('rejects a tampered payload and a tampered signature', () => {
    const token = issuePreviewPasswordToken(7, 1)
    const [payload, sig] = token.split('.')
    expect(verifyPreviewPasswordToken(`${payload}x.${sig}`, 7, 1)).toBe(false)
    expect(verifyPreviewPasswordToken(`${payload}.${sig}x`, 7, 1)).toBe(false)
  })

  it('rejects garbage and empty tokens', () => {
    expect(verifyPreviewPasswordToken('garbage', 7, 1)).toBe(false)
    expect(verifyPreviewPasswordToken('', 7, 1)).toBe(false)
  })

  it('rejects an expired token', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const token = issuePreviewPasswordToken(7, 1)
    // 8 days > the 7-day default max age.
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000)
    expect(verifyPreviewPasswordToken(token, 7, 1)).toBe(false)
    vi.useRealTimers()
  })

  it('scopes the cookie to preview.<base>, one level above the preview hosts', () => {
    process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN = '5-78-123-4.sslip.io'
    expect(previewPasswordCookieDomain()).toBe('preview.5-78-123-4.sslip.io')
    delete process.env.QUICKDDEVPREVIEWS_BASE_DOMAIN
    expect(previewPasswordCookieDomain()).toBeUndefined()
  })

  it('defaults the max age to 7 days', () => {
    expect(previewPasswordMaxAgeSec()).toBe(7 * 24 * 60 * 60)
  })
})
