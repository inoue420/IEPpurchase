import { describe, expect, it } from 'vitest'
import { rfqItemSchema } from './rfqItemSchema'

const input = { originalDescription: ' Bolt ', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: '', partNumber: '', productName: '', quantity: '2', unit: ' 個 ', requestedDeliveryDate: '', status: 'pending', note: '' }
describe('RFQ品目入力検証', () => { it('入力を整形して数量を数値化する', () => expect(rfqItemSchema.parse(input)).toMatchObject({ originalDescription: 'Bolt', quantity: 2, unit: '個' })); it('必須の説明・数量・単位を検証する', () => { expect(rfqItemSchema.safeParse({ ...input, originalDescription: ' ' }).success).toBe(false); expect(rfqItemSchema.safeParse({ ...input, quantity: '0' }).success).toBe(false); expect(rfqItemSchema.safeParse({ ...input, unit: ' ' }).success).toBe(false) }) })
