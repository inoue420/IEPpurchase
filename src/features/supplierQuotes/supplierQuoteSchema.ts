import { z } from 'zod'

export const SUPPLIER_QUOTE_STATUSES = ['draft', 'valid', 'withdrawn'] as const
export type SupplierQuoteStatus = typeof SUPPLIER_QUOTE_STATUSES[number]
export const supplierQuoteStatusLabels: Record<SupplierQuoteStatus, string> = { draft: '下書き', valid: '有効', withdrawn: '撤回' }

const amount = (label: string) => z.number({ error: `${label}は整数円で入力してください。` }).int(`${label}は整数円で入力してください。`).min(0, `${label}は0円以上で入力してください。`).max(1_000_000_000_000, `${label}が大きすぎます。`)

export const supplierQuoteSchema = z.object({
  supplierId: z.string().min(1, '仕入先を選択してください。').max(128), supplierName: z.string().trim().min(1).max(200), requestId: z.string().trim().max(128),
  quoteNumber: z.string().trim().min(1, '見積番号を入力してください。').max(200, '見積番号は200文字以内で入力してください。'), quoteDate: z.union([z.literal(''), z.iso.date()]), validUntil: z.union([z.literal(''), z.iso.date()]), documentId: z.string().trim().max(128),
  subtotal: amount('小計'), tax: amount('税額'), total: amount('総額'), status: z.enum(SUPPLIER_QUOTE_STATUSES), note: z.string().trim().max(5000, '備考は5000文字以内で入力してください。'),
}).superRefine((value, context) => { if (value.validUntil && value.quoteDate && value.validUntil < value.quoteDate) context.addIssue({ code: 'custom', path: ['validUntil'], message: '有効期限は見積日以降にしてください。' }); if (value.total !== value.subtotal + value.tax) context.addIssue({ code: 'custom', path: ['total'], message: '総額は小計と税額の合計にしてください。' }) })
