import { describe, expect, it } from 'vitest'
import { RAKUTEN_CANDIDATE_ATTEMPT_LIMIT, selectPartNumberMatchedRakutenItems } from './rakutenCandidateSelection'
import type { RakutenSearchItem } from '../marketplaceOffers/RakutenSearchDialog'

const item = (itemCode: string, itemName: string): RakutenSearchItem => ({ itemCode, itemName, itemPrice: 100, itemUrl: `https://example.test/${itemCode}`, shopName: 'ストア', taxFlag: 0, postageFlag: 0, availability: 1 })

describe('楽天候補の品番照合', () => {
  it('品番の記号・大文字小文字・全半角を正規化して上位5件を選ぶ', () => {
    const results = [item('1', 'AB-123 用'), item('2', 'ab 123 互換品'), item('3', 'AB124'), item('4', 'ＡＢ１２３ 正規品'), item('5', 'AB-123 セット'), item('6', 'AB-123 予備'), item('7', 'AB-123 予備2')]
    expect(selectPartNumberMatchedRakutenItems(results, 'ＡＢ-123').map(value => value.itemCode)).toEqual(['1', '2', '4', '5', '6'])
  })

  it('検索結果の先頭10件だけを試行する', () => {
    const results = Array.from({ length: RAKUTEN_CANDIDATE_ATTEMPT_LIMIT }, (_, index) => item(String(index), '一致しない商品'))
    results.push(item('10', 'ZX-9 対象商品'))
    expect(selectPartNumberMatchedRakutenItems(results, 'ZX-9')).toEqual([])
  })
})