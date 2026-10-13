import { describe, expect, it } from 'vitest'
import { rfqItemSchema, rfqItemStatusAfterRakutenSearch, rfqItemStatusLabels } from './rfqItemSchema'

describe('楽天検索後のRFQ品目状態', () => {
  it('商品が見つかると候補掲載済、見つからないと検索結果無しとする', () => {
    expect(rfqItemStatusAfterRakutenSearch('pending', true, false)).toBe('candidates_listed')
    expect(rfqItemStatusAfterRakutenSearch('sourcing', false, false)).toBe('no_search_results')
    expect(rfqItemStatusLabels.candidates_listed).toBe('候補掲載済')
    expect(rfqItemStatusLabels.no_search_results).toBe('検索結果無し')
  })
  it('再検索で最新の結果を反映する', () => {
    expect(rfqItemStatusAfterRakutenSearch('no_search_results', true, false)).toBe('candidates_listed')
    expect(rfqItemStatusAfterRakutenSearch('candidates_listed', false, false)).toBe('no_search_results')
  })
  it.each([true, false])('購入予定候補があれば見積取得済みを優先する: 一致=%s', hasMatches => {
    expect(rfqItemStatusAfterRakutenSearch('candidates_listed', hasMatches, true)).toBe('quoted')
  })
  it.each(['quoted', 'ordered', 'received', 'cancelled'] as const)('進んだ状態やキャンセルを再検索で戻さない: %s', status => {
    expect(rfqItemStatusAfterRakutenSearch(status, true, true)).toBe(status)
    expect(rfqItemStatusAfterRakutenSearch(status, false, false)).toBe(status)
  })
  it.each(['candidates_listed', 'no_search_results'] as const)('新しい状態で通常の品目編集ができる: %s', status => {
    const input = { originalDescription: 'Bolt', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: 'メーカー', partNumber: 'A-1', productName: '', quantity: 1, supplierResponseUnitPrice: null, unit: '個', supplierQuoteRequestEnabled: true, marketplaceOfferEnabled: true, ecPurchaseCandidates: [], requestedDeliveryDate: '', status, note: '' }
    expect(rfqItemSchema.safeParse(input).success).toBe(true)
  })
})
