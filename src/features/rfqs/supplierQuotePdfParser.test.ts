import { describe, expect, it } from 'vitest'
import { normalizePartNumber, parseSupplierQuotePdfText } from './supplierQuotePdfParser'

describe('仕入先見積PDFのテキスト解析', () => {
  it('品番と仕切単価を抽出する', () => {
    const text = '1 MC300DZ ７６ミリ充電式コンパクトカッタ 25,000 17,500 52,500 15,750 47,250 3\n2 A-61715 バッテリＢＬ１８２０Ｂ 14,700 10,290 30,870 8,800 26,400 3'
    expect(parseSupplierQuotePdfText(text)).toEqual([{ partNumber: 'MC300DZ', supplierResponseUnitPrice: 15750 }, { partNumber: 'A-61715', supplierResponseUnitPrice: 8800 }])
  })

  it('全角・半角と空白の差異を同じ品番として扱える', () => {
    expect(normalizePartNumber(' Ａ−６１７１５ ')).toBe('A-61715')
  })
})
