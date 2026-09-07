import { z } from 'zod'

export const RFQ_ITEM_STATUSES = ['pending', 'sourcing', 'quoted', 'ordered', 'received', 'cancelled'] as const
export type RfqItemStatus = typeof RFQ_ITEM_STATUSES[number]

export const rfqItemStatusLabels: Record<RfqItemStatus, string> = {
  pending: '未処理', sourcing: '仕入先選定中', quoted: '見積取得済み', ordered: '発注済み', received: '入荷済み', cancelled: 'キャンセル',
}

export const rfqItemSchema = z.object({
  originalDescription: z.string().trim().min(1, '品目説明を入力してください。').max(5000, '品目説明は5000文字以内で入力してください。'),
  translatedDescription: z.string().trim().max(5000, '翻訳説明は5000文字以内で入力してください。'),
  productId: z.string().max(128), manufacturerId: z.string().max(128), manufacturerName: z.string().trim().max(200, 'メーカー名は200文字以内で入力してください。'),
  partNumber: z.string().trim().max(200, '品番は200文字以内で入力してください。'), productName: z.string().trim().max(500, '商品名は500文字以内で入力してください。'),
  quantity: z.coerce.number().positive('数量は0より大きい数値を入力してください。').max(1_000_000_000, '数量が大きすぎます。'),
  unit: z.string().trim().min(1, '単位を入力してください。').max(50, '単位は50文字以内で入力してください。'),
  requestedDeliveryDate: z.union([z.literal(''), z.iso.date()]), status: z.enum(RFQ_ITEM_STATUSES), note: z.string().trim().max(5000, '備考は5000文字以内で入力してください。'),
})

export function localDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
