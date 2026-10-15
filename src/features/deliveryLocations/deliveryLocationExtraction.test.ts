import { describe, expect, it } from 'vitest'
import { deliveryLocationName, normalizeDeliveryLocation } from '../../../functions/src/deliveryLocationModel'
import { extractDeliveryLocationCandidates, withoutDeliveryLocationHeader } from './deliveryLocationExtraction'
import { parseBulkRfqItems } from '../rfqs/bulkRfqItemParser'
import { parseVisionOcrItems } from '../rfqs/visionOcrItemParser'

describe('delivery location extraction and matching', () => {
  it('extracts Japanese and English header fields, including OCR line breaks', () => {
    expect(extractDeliveryLocationCandidates('納品場所：東京倉庫\n納入先\n大阪支店\nDelivery Location: Nagoya warehouse\nShip to\tFukuoka')).toEqual(['東京倉庫', '大阪支店', 'Nagoya warehouse', 'Fukuoka'])
  })
  it('stops at adjacent PDF fields, does not guess from unrelated text, and omits placeholders', () => {
    expect(extractDeliveryLocationCandidates('納品先：東京倉庫  希望納期：2026/10/31\n納品場所：未定\n納入先：同上\n東京都千代田区\n担当者：山田')).toEqual(['東京倉庫'])
    expect(extractDeliveryLocationCandidates('納品先\n希望納期：2026/10/31')).toEqual([])
    expect(extractDeliveryLocationCandidates('納品先：ABC  倉庫')).toEqual(['ABC  倉庫'])
  })
  it('deduplicates normalized equivalent spellings but keeps similar places distinct', () => {
    expect(normalizeDeliveryLocation(' ＡＢＣ　倉庫 ')).toBe(normalizeDeliveryLocation('abc 倉庫'))
    expect(extractDeliveryLocationCandidates('納品先：ＡＢＣ　倉庫\n納品先：abc 倉庫\n納品先：ABC 第二倉庫')).toEqual(['abc 倉庫', 'ABC 第二倉庫'])
  })
  it('extracts a delivery location column and retains multiple destinations for review', () => {
    expect(extractDeliveryLocationCandidates('品番\t数量\t納品場所\nA-1\t2\t東京倉庫\nB-1\t3\t大阪倉庫')).toEqual(['東京倉庫', '大阪倉庫'])
    const firstColumn = '納品場所\tメーカー名\t品番\t詳細\t数量\t単位\n東京倉庫\tABC\tA-1\tボルト\t2\t本'
    expect(extractDeliveryLocationCandidates(firstColumn)).toEqual(['東京倉庫'])
    expect(parseBulkRfqItems(firstColumn)).toHaveLength(1)
    expect(withoutDeliveryLocationHeader(firstColumn)).toBe(firstColumn)
  })
  it('does not turn delivery headers into RFQ items or disrupt the following table', () => {
    const source = '納品場所：東京倉庫\nメーカー名\t品番\t詳細\t数量\t単位\nABC\tA-001\tボルト\t10\t本'
    expect(parseBulkRfqItems(source)).toHaveLength(1)
    expect(parseVisionOcrItems(source)).toHaveLength(1)
    expect(parseVisionOcrItems('納品場所\n東京倉庫\n六角ボルト 10 本')).toHaveLength(1)
    expect(withoutDeliveryLocationHeader('説明\n納期：来月')).toBe('説明\n納期：来月')
  })
  it('enforces the freee 255 character limit and rejects control characters', () => {
    expect(deliveryLocationName(' 倉庫 ')).toBe('倉庫')
    expect(deliveryLocationName('倉'.repeat(255))).toHaveLength(255)
    for (const invalid of ['倉'.repeat(256), '東京\n倉庫', '東京\t倉庫', '東京\u0000倉庫', '東京\u2028倉庫']) expect(() => deliveryLocationName(invalid)).toThrow('255')
  })
})
