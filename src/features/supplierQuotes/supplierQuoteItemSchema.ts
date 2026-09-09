import { z } from 'zod'
import { calculateLine, MAX_QUOTE_AMOUNT } from './quoteMoney'

const category = z.enum(['exclusive', 'inclusive', 'exempt'])
const id = z.string().min(1).max(128).regex(/^[^/]+$/)
export const supplierQuoteItemSchema = z.object({
  rfqItemId: id,
  productId: id.nullable(),
  partNumber: z.string().trim().max(200),
  itemName: z.string().trim().min(1, '品名を入力してください。').max(500),
  unit: z.string().trim().min(1, '単位を入力してください。').max(50),
  quantity: z.number(),
  unitPrice: z.number().int().min(0).max(1_000_000_000),
  shippingFee: z.number().int().min(0).max(MAX_QUOTE_AMOUNT),
  taxCategory: category, taxRateBps: z.number().int().min(0).max(10000),
  shippingTaxCategory: category, shippingTaxRateBps: z.number().int().min(0).max(10000),
  deliveryDate: z.union([z.literal(''), z.iso.date()]),
  note: z.string().trim().max(5000),
}).superRefine((value, context) => {
  try { calculateLine(value) } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '金額を確認してください。' })
  }
})
export type SupplierQuoteItemInput = z.infer<typeof supplierQuoteItemSchema>
