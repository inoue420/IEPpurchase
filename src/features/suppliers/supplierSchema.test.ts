import { describe, expect, it } from 'vitest'
import { supplierSchema } from './supplierSchema'

const validInput = { name: 'テスト商事', contactName: '', email: '', phone: '', postalCode: '', address: '', notes: '' }

describe('仕入先の入力検証', () => {
  it('名前のみで登録でき、任意の連絡先は空欄にできる', () => {
    expect(supplierSchema.parse(validInput)).toEqual(validInput)
  })
  it.each(['', '  ', '\t\n', '　'])('空白だけの仕入先名を拒否する: %j', name => {
    expect(supplierSchema.safeParse({ ...validInput, name }).success).toBe(false)
  })
  it('名前と連絡先の前後空白を除去する', () => {
    expect(supplierSchema.parse({ ...validInput, name: '  テスト商事　', email: ' buyer@example.com ' }))
      .toMatchObject({ name: 'テスト商事', email: 'buyer@example.com' })
  })
  it.each(['invalid', 'buyer@', 'buyer@example.com,other@example.com'])('不正なメールを拒否する: %s', email => {
    expect(supplierSchema.safeParse({ ...validInput, email }).success).toBe(false)
  })
  it('文字数上限を超えた名前と備考を拒否する', () => {
    expect(supplierSchema.safeParse({ ...validInput, name: 'あ'.repeat(201) }).success).toBe(false)
    expect(supplierSchema.safeParse({ ...validInput, notes: 'あ'.repeat(5001) }).success).toBe(false)
  })
  it('フォーム外の状態やIDを保存用入力に混入させない', () => {
    expect(supplierSchema.parse({ ...validInput, active: false, id: 'unexpected' })).toEqual(validInput)
  })
})
