import { describe, expect, it } from 'vitest'
import { customerSchema } from './customerSchema'

const validInput = { name: '石川エンタープライズ', contactName: '', email: '', phone: '', postalCode: '', address: '', notes: '' }

describe('customerSchema', () => {
  it('trims input before it is saved', () => {
    expect(customerSchema.parse({ ...validInput, name: '  顧客A  ' }).name).toBe('顧客A')
  })

  it('rejects an empty customer name and malformed email address', () => {
    expect(customerSchema.safeParse({ ...validInput, name: ' ' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...validInput, email: 'not-an-email' }).success).toBe(false)
  })
})
