import { z } from 'zod'

export const RFQ_STATUSES = ['received', 'sourcing', 'quoting', 'quoted', 'ordered', 'purchasing', 'received_goods', 'delivered', 'completed', 'cancelled'] as const
export type RfqStatus = typeof RFQ_STATUSES[number]

export const rfqStatusLabels: Record<RfqStatus, string> = {
  received: '受付', sourcing: '仕入先選定中', quoting: '見積作成中', quoted: '見積提出済み', ordered: '受注済み',
  purchasing: '購入中', received_goods: '入荷済み', delivered: '納品済み', completed: '完了', cancelled: 'キャンセル',
}

export const rfqSchema = z.object({
  customerId: z.string().min(1, '顧客を選択してください。'),
  subject: z.string().trim().min(1, '件名を入力してください。').max(500, '件名は500文字以内で入力してください。'),
  receivedAt: z.string().min(1, '見積依頼受信日を入力してください。'),
  dueDate: z.string(), requestedDeliveryDate: z.string(), status: z.enum(RFQ_STATUSES),
  assignedUserId: z.string().trim().max(128, '担当者IDは128文字以内で入力してください。'),
  note: z.string().trim().max(5000, '備考は5000文字以内で入力してください。'),
})
