import { describe, expect, it } from 'vitest'
import { includesSearchText, normalizeSearchText } from './searchText'

describe('normalizeSearchText', () => {
  it('normalizes full-width characters and surrounding whitespace', () => {
    expect(normalizeSearchText(' ＡＢＣ－１２３ ')).toBe('abc-123')
  })

  it('matches normalized query text against stored text', () => {
    expect(includesSearchText('ＡＢＣ－１２３', normalizeSearchText('abc-123'))).toBe(true)
  })
})
