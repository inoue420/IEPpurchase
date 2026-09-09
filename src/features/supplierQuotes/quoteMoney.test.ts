import { describe, expect, it } from 'vitest'
import { calculateLine, calculateTax, quantityMillis } from './quoteMoney'
import { supplierQuoteItemSchema } from './supplierQuoteItemSchema'

const line = { quantity: 2, unitPrice: 1000, shippingFee: 500, taxCategory: 'exclusive' as const, taxRateBps: 1000, shippingTaxCategory: 'exclusive' as const, shippingTaxRateBps: 1000 }
describe('supplier quote money', () => {
  it('includes shipping once and agrees for inclusive and exclusive prices', () => {
    expect(calculateLine(line)).toMatchObject({ subtotal: 2500, tax: 250, total: 2750, shippingTotal: 550 })
    expect(calculateLine({ ...line, unitPrice: 1100, shippingFee: 550, taxCategory: 'inclusive', shippingTaxCategory: 'inclusive' })).toMatchObject({ subtotal: 2500, tax: 250, total: 2750 })
    const first = calculateLine({ ...line, shippingFee: 400 })
    const second = calculateLine({ ...line, shippingFee: 200 })
    expect(first.shippingTotal + second.shippingTotal).toBe(660)
    expect(first.total + second.total).toBe(5060)
  })
  it('keeps decimal quantity exact and floors component amounts separately', () => {
    expect(quantityMillis(1.001)).toBe(1001)
    expect(calculateLine({ ...line, quantity: 1.001, unitPrice: 1000, shippingFee: 0 }).total).toBe(1101)
    expect(calculateLine({ ...line, quantity: 0.001, unitPrice: 999, shippingFee: 0 }).total).toBe(0)
    expect(calculateLine({ ...line, quantity: 1, unitPrice: 19, shippingFee: 19 }).tax).toBe(2)
  })
  it('supports mixed taxes, exempt goods and large integer arithmetic', () => {
    expect(calculateLine({ ...line, taxCategory: 'exempt', taxRateBps: 0 }).total).toBe(2550)
    expect(calculateTax(999999999999, 'inclusive', 9999)).toEqual({ subtotal: 500025001250, tax: 499974998749, total: 999999999999 })
    expect(calculateLine({ ...line, quantity: 1, unitPrice: 1000, taxRateBps: 800, shippingFee: 500 }).total).toBe(1630)
  })
  it.each([0, -1, NaN, Infinity, 1.0001, 1000001])('rejects invalid quantity %s without rounding', quantity => expect(() => calculateLine({ ...line, quantity })).toThrow())
  it('rejects negative, fractional, overflowing amounts and invalid taxes', () => {
    for (const change of [{ unitPrice: -1 }, { unitPrice: 0.5 }, { shippingFee: -1 }, { quantity: 1000000, unitPrice: 1000000000 }, { taxRateBps: 0.1 }, { taxCategory: 'exempt' as const, taxRateBps: 1000 }]) expect(() => calculateLine({ ...line, ...change })).toThrow()
  })
  it('validates dates, reference IDs and required item information', () => {
    const input = { ...line, rfqItemId: 'item', productId: null, itemName: '品名', partNumber: '', unit: '個', deliveryDate: '', note: '' }
    expect(supplierQuoteItemSchema.safeParse(input).success).toBe(true)
    for (const change of [{ deliveryDate: '2026-02-30' }, { rfqItemId: 'other/item' }, { itemName: '' }, { quantity: 0.0001 }]) expect(supplierQuoteItemSchema.safeParse({ ...input, ...change }).success).toBe(false)
  })
})
