import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { MarketplaceOffer } from '../marketplaceOffers/marketplaceOfferRepository'
import type { RfqItem } from '../rfqs/rfqItemRepository'
import type { SupplierQuoteItem } from '../supplierQuotes/supplierQuoteItemRepository'
import type { SupplierQuote } from '../supplierQuotes/supplierQuoteRepository'
import { buildSourcingCandidates, sortSourcingCandidates, type SourcingCandidate } from './sourcingComparison'

const rfqItem = { id: 'item-a' } as RfqItem
const offer = (id: string, rfqItemId: string, totalPrice: number | null) => ({
  id, rfqItemId, source: 'amazon', sellerName: '販売者', itemName: '商品', partNumber: 'A',
  quantity: 1, unit: '個', unitPrice: 100, shippingFee: totalPrice === null ? null : 10,
  totalPrice, stockStatus: '', itemUrl: null, retrievedAt: Timestamp.fromMillis(1000),
  estimatedDeliveryDate: null, note: '',
}) as MarketplaceOffer

describe('buildSourcingCandidates', () => {
  it('選択したRFQ品目以外の候補を混在させない', () => {
    const result = buildSourcingCandidates(rfqItem, [offer('a', 'item-a', 110), offer('b', 'item-b', 90)], [], {})
    expect(result.map((candidate) => candidate.id)).toEqual(['a'])
  })

  it('期限切れの仕入先見積を識別する', () => {
    const quote = {
      id: 'quote-a', archivedAt: null, status: 'valid', supplierName: '仕入先',
      validUntil: Timestamp.fromDate(new Date('2026-09-08T00:00:00+09:00')), quoteDate: null,
    } as SupplierQuote
    const item = {
      id: 'line-a', rfqItemId: 'item-a', itemName: '商品', partNumber: 'A', quantity: 1,
      unit: '個', unitPrice: 100, shippingFee: 10, total: 110, deliveryDate: null, note: '',
    } as SupplierQuoteItem
    const result = buildSourcingCandidates(rfqItem, [], [quote], { 'quote-a': [item] }, new Date('2026-09-09T00:00:00+09:00').getTime())
    expect(result[0].expired).toBe(true)
  })
})

describe('sortSourcingCandidates', () => {
  it('未確認の総額を末尾にする', () => {
    const base = { delivery: null, unitPrice: 100 } as SourcingCandidate
    const result = sortSourcingCandidates([{ ...base, id: 'unknown', total: null }, { ...base, id: 'known', total: 200 }], 'total')
    expect(result.map((candidate) => candidate.id)).toEqual(['known', 'unknown'])
  })
})
