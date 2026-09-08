import { describe, expect, it } from 'vitest'
import { supplierQuoteRequestSchema } from './supplierQuoteRequestSchema'

const valid = { supplierId: 'supplier', supplierName: '仕入先', rfqItemIds: ['item-1'], requestedAt: '', responseDueDate: '', status: 'draft' as const, note: '' }
describe('supplierQuoteRequestSchema', () => {
  it('accepts a draft with selected RFQ items', () => expect(supplierQuoteRequestSchema.safeParse(valid).success).toBe(true))
  it('requires a request date after the request is sent', () => expect(supplierQuoteRequestSchema.safeParse({ ...valid, status: 'requested' }).success).toBe(false))
  it('rejects a response due date before its request date and duplicated items', () => {
    expect(supplierQuoteRequestSchema.safeParse({ ...valid, requestedAt: '2026-09-10', responseDueDate: '2026-09-09' }).success).toBe(false)
    expect(supplierQuoteRequestSchema.safeParse({ ...valid, rfqItemIds: ['item-1', 'item-1'] }).success).toBe(false)
  })
  it('limits a request to 30 RFQ items', () => {
    const ids = Array.from({ length: 31 }, (_, index) => 'item-' + index)
    expect(supplierQuoteRequestSchema.safeParse({ ...valid, rfqItemIds: ids }).success).toBe(false)
  })
})
