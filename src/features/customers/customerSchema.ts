import { z } from 'zod'

export const customerSchema = z.object({
  name: z.string().trim().min(1, '顧客名を入力してください。').max(200, '顧客名は200文字以内で入力してください。'),
  contactName: z.string().trim().max(200, '担当者名は200文字以内で入力してください。'),
  email: z.string().trim().max(254, 'メールアドレスは254文字以内で入力してください。').refine(value => !value || z.email().safeParse(value).success, 'メールアドレスの形式を確認してください。'),
  phone: z.string().trim().max(50, '電話番号は50文字以内で入力してください。'),
  postalCode: z.string().trim().max(20, '郵便番号は20文字以内で入力してください。'),
  address: z.string().trim().max(1000, '住所は1000文字以内で入力してください。'),
  notes: z.string().trim().max(5000, '備考は5000文字以内で入力してください。'),
})
