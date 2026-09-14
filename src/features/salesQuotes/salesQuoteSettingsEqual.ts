import { parseQuoteSettings, type QuoteSettings } from '../../../functions/src/salesQuoteModel'

// Firestore and Callable responses may use different map key orders.
export function salesQuoteSettingsEqual(left: QuoteSettings, right: QuoteSettings): boolean {
  const canonical = (value: QuoteSettings) => {
    const parsed = parseQuoteSettings(value)
    parsed.prices.sort((a, b) => a.rfqItemId.localeCompare(b.rfqItemId))
    return JSON.stringify(parsed)
  }
  try { return canonical(left) === canonical(right) } catch { return false }
}
