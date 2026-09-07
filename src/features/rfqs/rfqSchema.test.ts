import { describe, expect, it } from 'vitest'
import { rfqSchema } from './rfqSchema'

const validInput = { customerId: 'customer-1', subject: '調達依頼', receivedAt: '2026-09-08', dueDate: '', requestedDeliveryDate: '', status: 'received' as const, assignedUserId: '', note: '' }

describe('rfqSchema', () => {
  it('accepts optional blank dates', () => {
    expect(rfqSchema.safeParse(validInput).success).toBe(true)
  })

  it('rejects invalid dates', () => {
    expect(rfqSchema.safeParse({ ...validInput, receivedAt: '2026-99-99' }).success).toBe(false)
    expect(rfqSchema.safeParse({ ...validInput, dueDate: '2026/09/10' }).success).toBe(false)
  })
})
