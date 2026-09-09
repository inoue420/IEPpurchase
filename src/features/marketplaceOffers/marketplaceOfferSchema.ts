import { z } from 'zod'
import { calculateLine } from '../supplierQuotes/quoteMoney'

export const marketplaceSources = ['amazon', 'rakuten', 'other'] as const
export type MarketplaceSource = typeof marketplaceSources[number]
const id = z.string().min(1).max(128).regex(/^[^/]+$/)
const category = z.enum(['exclusive', 'inclusive', 'exempt'])

export const marketplaceOfferSchema = z.object({
  rfqItemId: id, source: z.enum(marketplaceSources), externalItemId: z.string().trim().max(200), sellerName: z.string().trim().max(200),
  itemName: z.string().trim().min(1, '商品名を入力してください。').max(500), partNumber: z.string().trim().max(200), quantity: z.number(), unitPrice: z.number().int().min(0).max(1_000_000_000), shippingFee: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  taxCategory: category, taxRateBps: z.number().int().min(0).max(10000), shippingTaxCategory: category, shippingTaxRateBps: z.number().int().min(0).max(10000), stockStatus: z.string().trim().max(100), estimatedDeliveryDate: z.union([z.literal(''), z.iso.date()]), itemUrl: z.union([z.literal(''), z.url().refine(value => /^https?:\/\//.test(value), 'URLはhttp/httpsで入力してください。')]), retrievedAt: z.iso.datetime({ offset: true }), note: z.string().trim().max(5000),
}).superRefine((value, context) => { try { calculateLine({ quantity: value.quantity, unitPrice: value.unitPrice, shippingFee: value.shippingFee ?? 0, taxCategory: value.taxCategory, taxRateBps: value.taxRateBps, shippingTaxCategory: value.shippingTaxCategory, shippingTaxRateBps: value.shippingTaxRateBps }) } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '金額を確認してください。' }) } })
export type MarketplaceOfferInput = z.infer<typeof marketplaceOfferSchema>
