import { z } from 'zod'

export function normalizePartNumber(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[\s\-‐‑‒–—―ー－]/g, '')
}

export const productSchema = z.object({
  manufacturerName: z.string().trim().min(1, 'メーカー名を入力してください。').max(200, 'メーカー名は200文字以内で入力してください。'),
  partNumber: z.string().trim().min(1, '品番を入力してください。').max(200, '品番は200文字以内で入力してください。').refine(value => normalizePartNumber(value).length > 0, '品番には文字または数字を含めてください。'),
  name: z.string().trim().min(1, '正式商品名を入力してください。').max(500, '正式商品名は500文字以内で入力してください。'),
  janCode: z.string().trim().max(13, 'JANコードは13文字以内で入力してください。').refine(value => !value || /^(\d{8}|\d{13})$/.test(value), 'JANコードは8桁または13桁の数字で入力してください。'),
  category: z.string().trim().max(200, 'カテゴリは200文字以内で入力してください。'),
  unit: z.string().trim().min(1, '標準単位を入力してください。').max(50, '標準単位は50文字以内で入力してください。'),
  notes: z.string().trim().max(5000, '備考は5000文字以内で入力してください。'),
})
