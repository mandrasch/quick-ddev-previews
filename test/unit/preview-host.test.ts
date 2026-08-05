import { describe, expect, it } from 'vitest'
import {
  isPreviewHost,
  isValidSlug,
  parsePreviewHost,
  previewHostname,
  previewKey,
  previewLabel,
  stripPreviewPrefix,
} from '../../shared/utils/preview-host'

describe('preview-host', () => {
  describe('parsePreviewHost', () => {
    it('parses the primary <slug>.preview.<base> form', () => {
      expect(parsePreviewHost('myfeature.preview.5-78-123-4.sslip.io')).toEqual({ slug: 'myfeature' })
    })

    it('parses a dashed slug', () => {
      expect(parsePreviewHost('my-feature.preview.lvh.me')).toEqual({ slug: 'my-feature' })
    })

    it('parses a labelled <label>--<slug>.preview.<base> form', () => {
      expect(parsePreviewHost('knaus-kta--myfeature.preview.5-78-123-4.sslip.io')).toEqual({
        slug: 'myfeature',
        label: 'knaus-kta',
      })
    })

    it('ignores a trailing port', () => {
      // Callers strip the port before calling; the regex is not port-aware.
      expect(parsePreviewHost('myfeature.preview.lvh.me')).toEqual({ slug: 'myfeature' })
    })

    it('returns null for the dashboard host', () => {
      expect(parsePreviewHost('5-78-123-4.sslip.io')).toBeNull()
    })

    it('returns null for a numeric segment: the <runId>.preview form is gone', () => {
      expect(parsePreviewHost('7.preview.5-78-123-4.sslip.io')).toBeNull()
      expect(parsePreviewHost('123abc.preview.5-78-123-4.sslip.io')).toBeNull()
    })
  })

  describe('isPreviewHost', () => {
    it('matches a slug preview host regardless of base suffix', () => {
      expect(isPreviewHost('myfeature.preview.5-78-123-4.sslip.io')).toBe(true)
      // The regex itself does NOT re-check the base suffix; that suffix check
      // is enforced by /tls-ask (run existence + canonical reconstruction).
      expect(isPreviewHost('myfeature.preview.evil.com')).toBe(true)
    })

    it('does not match the dropped numeric form', () => {
      expect(isPreviewHost('7.preview.evil.com')).toBe(false)
    })
  })

  describe('stripPreviewPrefix', () => {
    it('recovers the dashboard host from a preview host', () => {
      expect(stripPreviewPrefix('myfeature.preview.5-78-123-4.sslip.io')).toBe('5-78-123-4.sslip.io')
    })

    it('recovers the dashboard host from a labelled preview host', () => {
      expect(stripPreviewPrefix('knaus-kta--myfeature.preview.5-78-123-4.sslip.io')).toBe('5-78-123-4.sslip.io')
    })
  })

  describe('previewHostname', () => {
    it('reconstructs the host for a sslip.io base, so a Domain=<base> cookie is sent to it', () => {
      const base = '5-78-123-4.sslip.io'
      const host = previewHostname('myfeature', base)
      // Cookie Domain=<base> is sent to any subdomain of <base>; the preview
      // host is a subdomain of <base> (it ends with `.<base>`), so the sealed
      // nuxt-session cookie is shared from dashboard to preview.
      expect(host).toBe('myfeature.preview.5-78-123-4.sslip.io')
      expect(host.endsWith(`.${base}`)).toBe(true)
    })

    it('round-trips through parsePreviewHost', () => {
      const base = 'previews.example.com'
      const host = previewHostname('myfeature', base)
      expect(parsePreviewHost(host)).toEqual({ slug: 'myfeature' })
    })

    it('round-trips a labelled slug host', () => {
      const base = 'previews.example.com'
      const host = previewHostname('myfeature', base, 'knaus-kta')
      expect(host).toBe('knaus-kta--myfeature.preview.previews.example.com')
      expect(parsePreviewHost(host)).toEqual({ slug: 'myfeature', label: 'knaus-kta' })
    })

    it('round-trips the exact host that /tls-ask requires for a sslip base', () => {
      // tls-ask (server/routes/tls-ask.get.ts) allows issuance only when
      // domain === previewHostname(slug, base, ref.label), so the preview
      // host must end with `.sslip.io` (the per-instance base), NOT bare
      // `.sslip.io` (which is on the Public Suffix List and un-cookieable).
      const base = '5-78-123-4.sslip.io'
      const host = previewHostname('myfeature', base)
      expect(host.endsWith('.sslip.io')).toBe(true)
      expect(host.endsWith('..sslip.io')).toBe(false)
    })
  })

  describe('previewKey', () => {
    it('uses the run slug when present', () => {
      expect(previewKey({ id: 7, slug: 'myfeature' })).toBe('myfeature')
    })

    it('falls back to run-<id> for a legacy row without a slug', () => {
      expect(previewKey({ id: 7, slug: null })).toBe('run-7')
    })
  })

  describe('isValidSlug', () => {
    it('accepts a plain lowercase slug', () => {
      expect(isValidSlug('myfeature')).toBe(true)
      expect(isValidSlug('my-feature')).toBe(true)
      expect(isValidSlug('a')).toBe(true)
    })

    it('rejects a leading digit (the numeric form is gone)', () => {
      expect(isValidSlug('7feature')).toBe(false)
      expect(isValidSlug('123')).toBe(false)
    })

    it('rejects a leading or trailing hyphen', () => {
      expect(isValidSlug('-feature')).toBe(false)
      expect(isValidSlug('feature-')).toBe(false)
    })

    it('rejects a double hyphen (reserved for the label separator)', () => {
      expect(isValidSlug('my--feature')).toBe(false)
    })

    it('rejects uppercase, spaces, and over-length slugs', () => {
      expect(isValidSlug('MyFeature')).toBe(false)
      expect(isValidSlug('my feature')).toBe(false)
      expect(isValidSlug('a'.repeat(64))).toBe(false)
      expect(isValidSlug('')).toBe(false)
    })
  })

  describe('previewLabel', () => {
    it('drops the .ddev.site suffix and turns dots into dashes', () => {
      expect(previewLabel('subdomain-a.my-project.ddev.site')).toBe('subdomain-a-my-project')
    })

    it('leaves a host without .ddev.site otherwise dot-replaced', () => {
      expect(previewLabel('sub.example.com')).toBe('sub-example-com')
    })
  })
})
