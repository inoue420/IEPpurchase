import { calculateSalesUnitPrice, type PurchaseAmountSource, type QuotePrice, type QuoteSettings } from '../../../functions/src/salesQuoteModel'
import type { RfqItem } from '../rfqs/rfqItemRepository'
import { isImportableRfqItem } from './salesQuotePreparation'

interface PurchaseAmountSuggestion {
  purchaseAmount: string
  purchaseAmountSource: Exclude<PurchaseAmountSource, 'manual'>
}

type PurchaseAmountRfqItem = Pick<RfqItem, 'id' | 'archivedAt' | 'status' | 'ecPurchaseCandidates' | 'supplierResponseUnitPrice'>

export const purchaseAmountSourceLabels: Record<PurchaseAmountSource, string> = {
  ec: 'EC購入予定',
  supplier: '仕入先回答',
  manual: '手入力',
}

export function getPurchaseAmountSuggestions(rfqItems: PurchaseAmountRfqItem[]): Map<string, PurchaseAmountSuggestion> {
  const suggestions = new Map<string, PurchaseAmountSuggestion>()
  for (const item of rfqItems) {
    if (!isImportableRfqItem(item)) continue
    const selected = item.ecPurchaseCandidates.filter(candidate => candidate.purchasePlanned)
    const amount = selected.length ? selected.reduce((total, candidate) => total + candidate.price, 0) : item.supplierResponseUnitPrice
    if (amount === null || !Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000) continue
    suggestions.set(item.id, { purchaseAmount: String(amount), purchaseAmountSource: selected.length ? 'ec' : 'supplier' })
  }
  return suggestions
}

export function getPurchaseAmountUpdate(price: QuotePrice, suggestion: PurchaseAmountSuggestion | undefined): QuotePrice | undefined {
  if (!suggestion || price.purchaseAmount === suggestion.purchaseAmount) return undefined
  const shippingFee = price.shippingFee ?? ''
  const margin = price.margin ?? '1.2'
  return {
    ...price,
    ...suggestion,
    shippingFee,
    margin,
    unitPrice: calculateSalesUnitPrice(suggestion.purchaseAmount, shippingFee, margin),
  }
}

export function fillSalesQuotePurchaseAmounts(settings: QuoteSettings, suggestions: ReadonlyMap<string, PurchaseAmountSuggestion>): QuoteSettings {
  const prices = settings.prices.map(price => {
    if (price.purchaseAmount || price.unitPrice || price.purchaseAmountSource) return price
    return getPurchaseAmountUpdate(price, suggestions.get(price.rfqItemId)) ?? price
  })
  return prices.some((price, index) => price !== settings.prices[index]) ? { ...settings, prices } : settings
}
