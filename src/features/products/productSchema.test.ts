import { describe, expect, it } from 'vitest'
import { normalizePartNumber, productSchema } from './productSchema'
const input = { manufacturerName: ' Makita ', partNumber: ' TD-173 ＤＺ ', name: ' インパクトドライバ ', janCode: '', category: '', unit: ' 個 ', notes: '' }
describe('商品入力検証', () => { it('前後空白を除去する', () => expect(productSchema.parse(input)).toMatchObject({ manufacturerName: 'Makita', partNumber: 'TD-173 ＤＺ', name: 'インパクトドライバ', unit: '個' })); it('必須項目とJANコードを検証する', () => { expect(productSchema.safeParse({ ...input, partNumber: '　' }).success).toBe(false); expect(productSchema.safeParse({ ...input, janCode: 'ABC' }).success).toBe(false) }); it('品番を検索用に正規化する', () => expect(normalizePartNumber(input.partNumber)).toBe('TD173DZ')) })
