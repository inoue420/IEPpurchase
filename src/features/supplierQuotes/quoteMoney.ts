export const MAX_QUOTE_AMOUNT = 1_000_000_000_000
export type TaxCategory = 'exclusive' | 'inclusive' | 'exempt'
export interface Amounts { subtotal: number; tax: number; total: number }
export interface LineMoneyInput {
  quantity: number; unitPrice: number; shippingFee: number
  taxCategory: TaxCategory; taxRateBps: number
  shippingTaxCategory: TaxCategory; shippingTaxRateBps: number
}

// Parse the decimal representation before multiplying: 1.001 must remain 1001.
export function quantityMillis(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || !/^\d+(\.\d{1,3})?$/.test(String(quantity))) {
    throw new Error('数量は0より大きく1,000,000以下、小数3桁以内で入力してください。')
  }
  const [whole, fraction = ''] = String(quantity).split('.')
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'))
}

export function calculateTax(amount: number, category: TaxCategory, rateBps: number): Amounts {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_QUOTE_AMOUNT ||
      !Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000 ||
      !['exclusive', 'inclusive', 'exempt'].includes(category) || (category === 'exempt' && rateBps !== 0)) {
    throw new Error('金額または税区分・税率が不正です。')
  }
  const tax = category === 'exempt' ? 0 : Number(BigInt(amount) * BigInt(rateBps) / BigInt(category === 'inclusive' ? 10000 + rateBps : 10000))
  const subtotal = category === 'inclusive' ? amount - tax : amount
  if (subtotal + tax > MAX_QUOTE_AMOUNT) throw new Error('合計金額が上限を超えています。')
  return { subtotal, tax, total: subtotal + tax }
}

export function calculateLine(input: LineMoneyInput): Amounts & { quantityMillis: number; shippingTotal: number } {
  const scaled = quantityMillis(input.quantity)
  if (!Number.isSafeInteger(input.unitPrice) || input.unitPrice < 0 || input.unitPrice > 1_000_000_000) throw new Error('単価は0〜1,000,000,000円の整数で入力してください。')
  const goods = calculateTax(Number(BigInt(scaled) * BigInt(input.unitPrice) / 1000n), input.taxCategory, input.taxRateBps)
  const shipping = calculateTax(input.shippingFee, input.shippingTaxCategory, input.shippingTaxRateBps)
  const total = goods.total + shipping.total
  if (total > MAX_QUOTE_AMOUNT) throw new Error('合計金額が上限を超えています。')
  return { quantityMillis: scaled, subtotal: goods.subtotal + shipping.subtotal, tax: goods.tax + shipping.tax, total, shippingTotal: shipping.total }
}
