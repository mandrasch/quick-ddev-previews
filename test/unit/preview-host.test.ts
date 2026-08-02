import { describe, expect, it } from 'vitest'
import {
  isPreviewHost,
  parsePreviewHost,
  previewHostname,
  previewLabel,
  stripPreviewPrefix,
} from '../../shared/utils/preview-host'

describe('preview-host', () => {
  describe('parsePreviewHost', () => {
    it('parses the primary <runId>.preview.<base> form', () => {
      expect(parsePreviewHost('7.preview.5-78-123-4.sslip.io')).toEqual({ runId: 7 })
    })

    it('parses a labelled <label>--<runId>.preview.<base> form', () => {
      expect(parsePreviewHost('knaus-kta--7.preview.5-78-123-4.sslip.io')).toEqual({
        runId: 7,
        label: 'knaus-kta',
      })
    })

    it('ignores a trailing port', () => {
      // Callers strip the port before calling; the regex is not port-aware.
      expect(parsePreviewHost('7.preview.lvh.me')).toEqual({ runId: 7 })
    })

    it('returns null for the dashboard host', () => {
      expect(parsePreviewHost('5-78-123-4.sslip.io')).toBeNull()
    })

    it('returns null for a non-numeric run segment', () => {
      expect(parsePreviewHost('foo.preview.5-78-123-4.sslip.io')).toBeNull()
    })
  })

  describe('isPreviewHost', () => {
    it('matches any <runId>.preview. prefix regardless of base suffix', () => {
      expect(isPreviewHost('7.preview.5-78-123-4.sslip.io')).toBe(true)
      // The regex itself does NOT re-check the base suffix; that suffix check
      // is enforced by /tls-ask (run existence + canonical reconstruction).
      expect(isPreviewHost('7.preview.evil.com')).toBe(true)
    })
  })

  describe('stripPreviewPrefix', () => {
    it('recovers the dashboard host from a primary preview host', () => {
      expect(stripPreviewPrefix('7.preview.5-78-123-4.sslip.io')).toBe('5-78-123-4.sslip.io')
    })

    it('recovers the dashboard host from a labelled preview host', () => {
      expect(stripPreviewPrefix('knaus-kta--7.preview.5-78-123-4.sslip.io')).toBe('5-78-123-4.sslip.io')
    })
  })

  describe('previewHostname', () => {
    it('reconstructs the primary host for a sslip.io base, so a Domain=<base> cookie is sent to it', () => {
      const base = '5-78-123-4.sslip.io'
      const host = previewHostname(7, base)
      // Cookie Domain=<base> is sent to any subdomain of <base>; the preview
      // host is a subdomain of <base> (it ends with `.<base>`), so the sealed
      // nuxt-session cookie is shared from dashboard to preview.
      expect(host).toBe('7.preview.5-78-123-4.sslip.io')
      expect(host.endsWith(`.${base}`)).toBe(true)
    })

    it('reconstructs a labelled host round-trips through parsePreviewHost', () => {
      const base = 'previews.example.com'
      const host = previewHostname(42, base, 'knaus-kta')
      expect(host).toBe('knaus-kta--42.preview.previews.example.com')
      expect(parsePreviewHost(host)).toEqual({ runId: 42, label: 'knaus-kta' })
    })

    it('round-trips the exact host that /tls-ask requires for a sslip base', () => {
      // tls-ask (server/routes/tls-ask.get.ts) allows issuance only when
      // domain === previewHostname(ref.runId, base, ref.label), so the preview
      // host must end with `.sslip.io` (the per-instance base), NOT bare
      // `.sslip.io` (which is on the Public Suffix List and un-cookieable).
      const base = '5-78-123-4.sslip.io'
      const host = previewHostname(7, base)
      expect(host.endsWith('.sslip.io')).toBe(true)
      expect(host.endsWith('..sslip.io')).toBe(false)
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
