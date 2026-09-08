import { z } from 'zod'

export const SUPPLIER_QUOTE_REQUEST_STATUSES = ['draft', 'requested', 'partially_answered', 'answered', 'cancelled'] as const
export type SupplierQuoteRequestStatus = typeof SUPPLIER_QUOTE_REQUEST_STATUSES[number]
export const supplierQuoteRequestStatusLabels: Record<SupplierQuoteRequestStatus, string> = { draft: '下書き', requested: '依頼済み', partially_answered: '一部回答', answered: '回答済み', cancelled: '取消' }
export const supplierQuoteRequestSchema = z.object({
  supplierId: z.string().min(1, '仕入先を選択してください。').max(128),
  supplierName: z.string().trim().min(1).max(200),
  rfqItemIds: z.array(z.string().min(1).max(128)).min(1, '対象品目を1件以上選択してください。').max(30, '対象品目は30件まで選択できます。').refine(ids => new Set(ids).size === ids.length, '同じ品目を重複して選択できません。'),
  requestedAt: z.union([z.literal(''), z.iso.date()]), responseDueDate: z.union([z.literal(''), z.iso.date()]),
  status: z.enum(SUPPLIER_QUOTE_REQUEST_STATUSES), note: z.string().trim().max(5000, '備考は5000文字以内で入力してください。'),
}).superRefine((value, context) => {
  if (value.status !== 'draft' && !value.requestedAt) context.addIssue({ code: 'custom', path: ['requestedAt'], message: '依頼済み以降の状態では依頼日を入力してください。' })
  if (value.requestedAt && value.responseDueDate && value.responseDueDate < value.requestedAt) context.addIssue({ code: 'custom', path: ['responseDueDate'], message: '回答期限は依頼日以降にしてください。' })
})
