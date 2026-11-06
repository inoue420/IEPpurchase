import { describe, expect, it } from 'vitest'
import { matchSupplierQuotePdfRows, normalizePartNumber, parseSupplierQuotePdfText } from './supplierQuotePdfParser'

describe('仕入先見積PDFのテキスト解析', () => {
  it('品番と仕切単価を抽出する', () => {
    const text = '1 MC300DZ ７６ミリ充電式コンパクトカッタ 25,000 17,500 52,500 15,750 47,250 3\n2 A-61715 バッテリＢＬ１８２０Ｂ 14,700 10,290 30,870 8,800 26,400 3'
    expect(parseSupplierQuotePdfText(text)).toEqual([{ partNumber: 'MC300DZ', supplierResponseUnitPrice: 15750 }, { partNumber: 'A-61715', supplierResponseUnitPrice: 8800 }])
  })

  it('全角・半角と空白の差異を同じ品番として扱える', () => {
    expect(normalizePartNumber(' Ａ−６１７１５ ')).toBe('A-61715')
  })

  it('添付の備考付き6行を抽出し、RFQの同一品番2行も確認対象にする', () => {
    const text = [
      '1 MP181DZ 18V充電式空気入れ 19,900 13,930 27,860 12,510 25,020 2 本体のみ',
      '2 BL1860B 18V6.0Ahバッテリ 25,700 17,990 35,980 15,400 30,800 2',
      '3 DC18RD 18V２口急速充電器 29,700 20,790 41,580 17,800 35,600 2 ２個同時急速充電',
      '4 A-75306 空気入れ用エアチャック３０度 3,900 2,730 5,460 2,300 4,600 2',
      '5 UB186DZ 18Vブロワ（ロングノズル仕様） 13,900 9,730 9,730 8,730 8,730 1 USmakitaXBU06',
      '6 BL1860B 18V6.0Ahバッテリ 25,700 17,990 17,990 15,400 15,400 1',
    ].join('\n')
    const rows = parseSupplierQuotePdfText(text)
    expect(rows).toEqual([
      { partNumber: 'MP181DZ', supplierResponseUnitPrice: 12510 },
      { partNumber: 'BL1860B', supplierResponseUnitPrice: 15400 },
      { partNumber: 'DC18RD', supplierResponseUnitPrice: 17800 },
      { partNumber: 'A-75306', supplierResponseUnitPrice: 2300 },
      { partNumber: 'UB186DZ', supplierResponseUnitPrice: 8730 },
      { partNumber: 'BL1860B', supplierResponseUnitPrice: 15400 },
    ])
    const items = ['MP181DZ', 'BL1860B', 'DC18RD', 'A - 75306', 'UB186DZ', 'BL1860B'].map((partNumber, index) => ({ id: `item-${index + 1}`, partNumber }))
    const matches = matchSupplierQuotePdfRows(items, rows)
    expect(matches.map(match => [match.item.id, match.row.supplierResponseUnitPrice])).toEqual([
      ['item-1', 12510], ['item-2', 15400], ['item-3', 17800], ['item-4', 2300], ['item-5', 8730], ['item-6', 15400],
    ])
  })

  it('重複品番の単価が異なっても正規化後に最初の行を優先し、未一致品番は除外する', () => {
    const rows = parseSupplierQuotePdfText([
      '1 ＢＬ１８６０Ｂ バッテリ 25,700 17,990 35,980 15,400 30,800 2',
      '2 BL1860B バッテリ 25,700 17,990 17,990 12,000 12,000 1',
    ].join('\n'))
    const matches = matchSupplierQuotePdfRows([{ partNumber: 'bl1860b' }, { partNumber: 'BL1860B' }, { partNumber: 'UNKNOWN' }], rows)
    expect(matches).toHaveLength(2)
    expect(matches.map(match => match.row)).toEqual([rows[0], rows[0]])
  })

  it('後のページでNo.が振り直されていても前のページの単価を優先する', () => {
    const rows = parseSupplierQuotePdfText('6 BL1860B バッテリ 25,700 17,990 17,990 15,400 15,400 1\n\n1 BL1860B バッテリ 25,700 17,990 17,990 12,000 12,000 1')
    expect(matchSupplierQuotePdfRows([{ partNumber: 'BL1860B' }], rows)[0].row.supplierResponseUnitPrice).toBe(15400)
  })

  it.each(['本体のみ', '2 個同時急速充電', 'USmakitaXBU06', '100 200 300 400 500 600 700'])('備考「%s」の数字を価格として読み違えない', note => {
    expect(parseSupplierQuotePdfText(`1 MP181DZ 18V充電式空気入れ 19,900 13,930 27,860 12,510 25,020 2 ${note}`)).toEqual([
      { partNumber: 'MP181DZ', supplierResponseUnitPrice: 12510 },
    ])
  })

  it('備考なしの末尾空白とCRLFにも対応し、表外の行と不正な単価は抽出しない', () => {
    expect(parseSupplierQuotePdfText('品番 品名 定価 売価 売価合計 仕切単価 仕切合計 数量\r\n1 MP181DZ 空気入れ 19,900 13,930 27,860 12,510 25,020 2  \r\n138,600 120,150\r\n2 BAD 不正 1 1 1 9007199254740992 1 1')).toEqual([
      { partNumber: 'MP181DZ', supplierResponseUnitPrice: 12510 },
    ])
  })
})
