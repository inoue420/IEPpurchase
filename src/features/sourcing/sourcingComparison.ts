import type { MarketplaceOffer } from '../marketplaceOffers/marketplaceOfferRepository'
import type { RfqItem } from '../rfqs/rfqItemRepository'
import type { SupplierQuoteItem } from '../supplierQuotes/supplierQuoteItemRepository'
import type { SupplierQuote } from '../supplierQuotes/supplierQuoteRepository'

export type SourcingSortKey = 'total' | 'unitPrice' | 'delivery'

export interface SourcingCandidate {
  id: string
  kind: 'supplier' | 'marketplace'
  source: string
  seller: string
  itemName: string
  partNumber: string
  quantity: number
  unit: string
  unitPrice: number
  shippingFee: number | null
  total: number | null
  delivery: Date | null
  stock: string
  url: string | null
  observedAt: Date | null
  note: string
  expired: boolean
}

const sourceLabels = { amazon: 'Amazon', rakuten: '楽天', other: 'その他' } as const

export function buildSourcingCandidates(
  rfqItem: RfqItem,
  offers: MarketplaceOffer[],
  quotes: SupplierQuote[],
  quoteItems: Record<string, SupplierQuoteItem[]>,
  todayStart = new Date().setHours(0, 0, 0, 0),
): SourcingCandidate[] {
  const marketplace = offers
    .filter((offer) => offer.rfqItemId === rfqItem.id)
    .map((offer) => ({
      id: offer.id,
      kind: 'marketplace' as const,
      source: sourceLabels[offer.source],
      seller: offer.sellerName,
      itemName: offer.itemName,
      partNumber: offer.partNumber,
      quantity: offer.quantity,
      unit: offer.unit,
      unitPrice: offer.unitPrice,
      shippingFee: offer.shippingFee,
      total: offer.totalPrice,
      delivery: offer.estimatedDeliveryDate?.toDate() ?? null,
      stock: offer.stockStatus,
      url: offer.itemUrl,
      observedAt: offer.retrievedAt.toDate(),
      note: offer.note,
      expired: false,
    }))

  const supplier = quotes
    .filter((quote) => quote.archivedAt === null && quote.status !== 'withdrawn')
    .flatMap((quote) => (quoteItems[quote.id] ?? [])
      .filter((item) => item.rfqItemId === rfqItem.id)
      .map((item) => ({
        id: item.id,
        kind: 'supplier' as const,
        source: '仕入先見積',
        seller: quote.supplierName,
        itemName: item.itemName,
        partNumber: item.partNumber,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        shippingFee: item.shippingFee,
        total: item.total,
        delivery: item.deliveryDate?.toDate() ?? null,
        stock: '',
        url: null,
        observedAt: quote.quoteDate?.toDate() ?? null,
        note: item.note,
        expired: quote.validUntil !== null && quote.validUntil.toDate().getTime() < todayStart,
      })))

  return [...supplier, ...marketplace]
}

export function sortSourcingCandidates(candidates: SourcingCandidate[], key: SourcingSortKey) {
  return [...candidates].sort((left, right) => {
    if (key === 'delivery') {
      return (left.delivery?.getTime() ?? Number.MAX_SAFE_INTEGER)
        - (right.delivery?.getTime() ?? Number.MAX_SAFE_INTEGER)
    }
    return (left[key] ?? Number.MAX_SAFE_INTEGER) - (right[key] ?? Number.MAX_SAFE_INTEGER)
  })
}
