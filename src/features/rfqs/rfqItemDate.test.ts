import { describe, expect, it } from 'vitest'
import { localDateInput, rfqItemSchema } from './rfqItemSchema'
const input = { originalDescription: 'Bolt', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: '', partNumber: '', productName: '', quantity: 1, unit: '個', requestedDeliveryDate: '', status: 'pending', note: '' }
describe('品目の日付と数値の境界', () => {
  it('ローカル日付をUTC変換せずにフォームへ戻す', () => {
    expect(localDateInput(new Date(2026, 8, 8, 0, 0, 0))).toBe('2026-09-08')
  })
  it.each(['2026-02-30', 'invalid'])('不正日付 %s を拒否する', value => {
    expect(rfqItemSchema.safeParse({ ...input, requestedDeliveryDate: value }).success).toBe(false)
  })
  it.each(['', 0, -1, NaN, Infinity])('不正数量 %s を拒否する', quantity => {
    expect(rfqItemSchema.safeParse({ ...input, quantity }).success).toBe(false)
  })
  it('小数数量と閏日を受け入れる', () => {
    expect(rfqItemSchema.safeParse({ ...input, quantity: 0.25, requestedDeliveryDate: '2028-02-29' }).success).toBe(true)
  })
})
