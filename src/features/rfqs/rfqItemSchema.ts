import { z } from 'zod'

export const RFQ_ITEM_STATUSES = ['pending', 'sourcing', 'quoted', 'ordered', 'received', 'cancelled'] as const
export type RfqItemStatus = typeof RFQ_ITEM_STATUSES[number]

export const rfqItemStatusLabels: Record<RfqItemStatus, string> = {
  pending: '未処理', sourcing: '仕入先選定中', quoted: '見積取得済み', ordered: '発注済み', received: '入荷済み', cancelled: 'キャンセル',
}

export const ecPurchaseCandidateSchema = z.object({
  storeProductName: z.string().trim().min(1, 'ストア掲載商品名を入力してください。').max(500, 'ストア掲載商品名は500文字以内で入力してください。'),
  url: z.string().trim().url('URLを正しく入力してください。').max(2000, 'URLは2000文字以内で入力してください。'),
  price: z.coerce.number().int('価格は整数で入力してください。').min(0, '価格は0円以上で入力してください。').max(1_000_000_000, '価格が大きすぎます。'),
  purchasePlanned: z.boolean().default(false),
})

export const rfqItemSchema = z.object({
  originalDescription: z.string().trim().min(1, '品目説明を入力してください。').max(5000, '品目説明は5000文字以内で入力してください。'),
  translatedDescription: z.string().trim().max(5000, '翻訳説明は5000文字以内で入力してください。'),
  productId: z.string().max(128), manufacturerId: z.string().max(128), manufacturerName: z.string().trim().max(200, 'メーカー名は200文字以内で入力してください。'),
  partNumber: z.string().trim().max(200, '品番は200文字以内で入力してください。'), productName: z.string().trim().max(500, '商品名は500文字以内で入力してください。'),
  quantity: z.coerce.number().positive('数量は0より大きい数値を入力してください。').max(1_000_000_000, '数量が大きすぎます。'),
  supplierResponseUnitPrice: z.union([z.null(), z.coerce.number().int('仕入先回答単価は整数で入力してください。').min(0, '仕入先回答単価は0円以上で入力してください。').max(1_000_000_000, '仕入先回答単価が大きすぎます。')]),
  unit: z.string().trim().min(1, '単位を入力してください。').max(50, '単位は50文字以内で入力してください。'),
  supplierQuoteRequestEnabled: z.boolean(), marketplaceOfferEnabled: z.boolean(),
  ecPurchaseCandidates: z.array(ecPurchaseCandidateSchema).max(10, 'EC購入候補は10件まで登録できます。'),
  requestedDeliveryDate: z.union([z.literal(''), z.iso.date()]), status: z.enum(RFQ_ITEM_STATUSES), note: z.string().trim().max(5000, '備考は5000文字以内で入力してください。'),
}).refine(value => value.supplierQuoteRequestEnabled || value.marketplaceOfferEnabled, { message: '対応先を1つ以上選択してください。', path: ['supplierQuoteRequestEnabled'] })

export function localDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
