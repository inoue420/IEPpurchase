import { describe, expect, it } from 'vitest'
import { marketplaceOfferSchema } from './marketplaceOfferSchema'

const valid = {
  rfqItemId: 'item-1', source: 'amazon' as const, externalItemId: 'ASIN-1',
  sellerName: '販売者', itemName: '商品', partNumber: 'A-1',
  quantity: 2, unitPrice: 1000, shippingFee: 500,
  taxCategory: 'exclusive' as const, taxRateBps: 1000,
  shippingTaxCategory: 'exclusive' as const, shippingTaxRateBps: 1000,
  stockStatus: '在庫あり', estimatedDeliveryDate: '2026-09-15',
  itemUrl: 'https://example.com/item', retrievedAt: '2026-09-09T12:00:00+09:00', note: '',
}

describe('marketplace offer schema', () => {
  it('accepts known, free and unknown shipping distinctly', () => {
    expect(marketplaceOfferSchema.safeParse(valid).success).toBe(true)
    expect(marketplaceOfferSchema.safeParse({ ...valid, shippingFee: 0 }).success).toBe(true)
    expect(marketplaceOfferSchema.safeParse({ ...valid, shippingFee: null }).success).toBe(true)
  })
  it.each([
    { rfqItemId: 'other/item' }, { source: 'unknown' }, { quantity: 0 },
    { quantity: 1.0001 }, { unitPrice: 0.5 }, { shippingFee: -1 },
    { itemUrl: 'javascript:alert(1)' }, { estimatedDeliveryDate: '2026-02-30' },
    { taxCategory: 'exempt', taxRateBps: 1000 },
  ])('rejects invalid input: %j', change => {
    expect(marketplaceOfferSchema.safeParse({ ...valid, ...change }).success).toBe(false)
  })
})
