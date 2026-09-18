import { describe, expect, it } from 'vitest'
import { parseVisionOcrItems } from './visionOcrItemParser'

describe('Vision OCR品目候補', () => {
  it('見出し付きOCR表は既存の一括登録形式として読み取る', () => {
    const rows = parseVisionOcrItems('メーカー名\t品番\t詳細\t数量\t単位\nABC\tA-100\t六角ボルト\t12\t本')
    expect(rows[0]).toMatchObject({ error: null, input: { manufacturerName: 'ABC', partNumber: 'A-100', originalDescription: '六角ボルト', quantity: 12, unit: '本' } })
  })

  it('見出しがないOCR行から品番・数量・単位を候補化する', () => {
    const rows = parseVisionOcrItems('ABC A-100 六角ボルト 12 本')
    expect(rows[0]).toMatchObject({ error: null, input: { partNumber: 'A-100', quantity: 12, unit: '本' } })
    expect(rows[0].input.originalDescription).toContain('A-100')
  })

  it('候補は50件までに制限する', () => {
    expect(parseVisionOcrItems(Array.from({ length: 60 }, (_, index) => `ITEM-${index + 1}`).join('\n'))).toHaveLength(50)
  })

  it('座標復元された表で単位を補完し、品名内の型番を候補化する', () => {
    const rows = parseVisionOcrItems('メーカー名\t詳細\t数量\nスプレノン\t網 大型 青\t1\nMAKITA\tTD173DZ 充電式ドライバー\t2')
    expect(rows).toMatchObject([
      { error: null, input: { manufacturerName: 'スプレノン', originalDescription: '網 大型 青', partNumber: '', quantity: 1, unit: '個' } },
      { error: null, input: { manufacturerName: 'MAKITA', originalDescription: 'TD173DZ 充電式ドライバー', partNumber: 'TD173DZ', quantity: 2, unit: '個' } },
    ])
  })
})
