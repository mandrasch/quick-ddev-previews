import { describe, expect, it } from 'vitest'
import {
  ENV_VALUE_MASK,
  maskEnvVars,
  unmaskEnvVars,
} from '../../server/utils/env-mask'

describe('env-mask', () => {
  describe('maskEnvVars', () => {
    it('masks non-empty values, leaves empty ones alone', () => {
      expect(maskEnvVars([
        { key: 'DB_PASSWORD', value: 's3cret' },
        { key: 'EMPTY_FLAG', value: '' },
      ])).toEqual([
        { key: 'DB_PASSWORD', value: ENV_VALUE_MASK },
        { key: 'EMPTY_FLAG', value: '' },
      ])
    })
  })

  describe('unmaskEnvVars', () => {
    it('keeps the stored value when the editor sent the mask back unchanged', () => {
      const stored = [{ key: 'DB_PASSWORD', value: 's3cret' }]
      const edited = [{ key: 'DB_PASSWORD', value: ENV_VALUE_MASK }]
      expect(unmaskEnvVars(stored, edited)).toEqual([{ key: 'DB_PASSWORD', value: 's3cret' }])
    })

    it('takes the new value when the editor replaced the mask', () => {
      const stored = [{ key: 'DB_PASSWORD', value: 's3cret' }]
      const edited = [{ key: 'DB_PASSWORD', value: 'new-value' }]
      expect(unmaskEnvVars(stored, edited)).toEqual([{ key: 'DB_PASSWORD', value: 'new-value' }])
    })

    it('clears the value when the editor emptied it', () => {
      const stored = [{ key: 'DB_PASSWORD', value: 's3cret' }]
      const edited = [{ key: 'DB_PASSWORD', value: '' }]
      expect(unmaskEnvVars(stored, edited)).toEqual([{ key: 'DB_PASSWORD', value: '' }])
    })

    it('drops keys removed from the editor', () => {
      const stored = [{ key: 'A', value: '1' }, { key: 'B', value: '2' }]
      expect(unmaskEnvVars(stored, [{ key: 'B', value: ENV_VALUE_MASK }]))
        .toEqual([{ key: 'B', value: '2' }])
    })
  })
})
