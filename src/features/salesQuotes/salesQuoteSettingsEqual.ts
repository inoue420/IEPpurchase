import { calculateSalesUnitPrice, parseQuoteSettings, type QuoteSettings } from '../../../functions/src/salesQuoteModel'

// Recalculate editable drafts without modifying their saved snapshots or manual prices.
export function recalculateSalesQuoteSettings(settings: QuoteSettings): QuoteSettings {
  return { ...settings, prices: settings.prices.map(price => price.purchaseAmount ? {
    ...price, unitPrice: calculateSalesUnitPrice(price.purchaseAmount, price.shippingFee, price.margin),
  } : { ...price }) }
}

// Keep existing prices when RFQ lines are reimported; only added lines use defaults.
export function alignSalesQuotePrices(settings: QuoteSettings, defaults: QuoteSettings): QuoteSettings {
  return { ...settings, prices: defaults.prices.map(price => settings.prices.find(previous => previous.rfqItemId === price.rfqItemId) ?? price) }
}

// An absent EC selection is not a replacement for an explicitly saved/manual cost.
export function syncSalesQuotePurchaseAmounts(settings: QuoteSettings, amounts: ReadonlyMap<string, string>): QuoteSettings {
  return { ...settings, prices: settings.prices.map(price => {
    const purchaseAmount = amounts.get(price.rfqItemId)
    if (!purchaseAmount || price.purchaseAmount === purchaseAmount) return price
    const shippingFee = price.shippingFee ?? '', margin = price.margin ?? '1.2'
    return { ...price, purchaseAmount, shippingFee, margin, unitPrice: calculateSalesUnitPrice(purchaseAmount, shippingFee, margin) }
  }) }
}

// Firestore and Callable responses may use different map key orders.
export function salesQuoteSettingsEqual(left: QuoteSettings, right: QuoteSettings): boolean {
  const canonical = (value: QuoteSettings) => {
    const parsed = parseQuoteSettings(value)
    parsed.prices.sort((a, b) => a.rfqItemId.localeCompare(b.rfqItemId))
    return JSON.stringify(parsed)
  }
  try { return canonical(left) === canonical(right) } catch { return false }
}
