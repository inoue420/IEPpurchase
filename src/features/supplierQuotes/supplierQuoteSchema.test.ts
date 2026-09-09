import { describe, expect, it } from 'vitest'
import { supplierQuoteSchema } from './supplierQuoteSchema'

const valid = { supplierId: 'supplier-1', supplierName: '仕入先', requestId: '', quoteNumber: 'SQ-001', quoteDate: '2026-09-09', validUntil: '2026-09-30', documentId: '', subtotal: 1000, tax: 100, total: 1100, status: 'valid' as const, note: '' }
describe('supplierQuoteSchema', () => {
  it('accepts a valid header without a document', () => expect(supplierQuoteSchema.safeParse(valid).success).toBe(true))
  it('rejects a total that does not match subtotal plus tax', () => expect(supplierQuoteSchema.safeParse({ ...valid, total: 1099 }).success).toBe(false))
  it('rejects a negative amount and an invalid date range', () => { expect(supplierQuoteSchema.safeParse({ ...valid, tax: -1 }).success).toBe(false); expect(supplierQuoteSchema.safeParse({ ...valid, validUntil: '2026-09-08' }).success).toBe(false) })
})
