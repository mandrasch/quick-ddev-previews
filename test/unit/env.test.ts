import { describe, expect, it } from 'vitest'
import { parseEnvText } from '../../app/utils/env'

describe('env textbox format', () => {
  describe('parseEnvText', () => {
    it('parses KEY=VALUE lines and drops comments and blank lines', () => {
      expect(parseEnvText([
        '# a comment',
        '',
        'APP_URL=https://example.com',
        '  DB_HOST=db  ',
        'EMPTY=',
      ].join('\n'))).toEqual([
        { key: 'APP_URL', value: 'https://example.com' },
        { key: 'DB_HOST', value: 'db' },
        { key: 'EMPTY', value: '' },
      ])
    })

    it('ignores lines without an equals sign', () => {
      expect(parseEnvText('APP_URL=https://x.com\nnot-a-key-value')).toEqual([
        { key: 'APP_URL', value: 'https://x.com' },
      ])
    })
  })
})
