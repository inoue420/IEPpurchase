import { describe, expect, it } from 'vitest'
import { matchSupplierQuotePdfRows, normalizePartNumber, parseSupplierQuotePdfPage, parseSupplierQuotePdfText } from './supplierQuotePdfParser'

describe('仕入先見積PDFのテキスト解析', () => {
  function cell(str: string, x: number, y: number, width: number) {
    return { str, transform: [10, 0, 0, 10, x, y], width, height: 10 }
  }
  const compactHead = [
    cell('品番', 90, 300, 20), cell('品名', 180, 300, 20), cell('定価', 270, 300, 20),
    cell('参考売価', 320, 300, 40), cell('仕切', 380, 300, 20), cell('単価', 400, 300, 20), cell('備考', 490, 300, 20),
  ]

  it.each([90, 180, 270])('ページ回転 %i 度でも備考付きの仕切単価を読み、上の行を優先する', rotation => {
    const cells = [...compactHead, ...[4200, 3900].flatMap((amount, index) => {
      const y = 282 - 16 * index
      return [cell(String(index + 1), 48, y, 5), cell('F-01356', 72, y, 42), cell('ピンネイル', 132, y, 50),
        cell('7,000', 282, y, 25), cell('4,900', 342, y, 25), cell(amount.toLocaleString('en-US'), 402, y, 25), cell('廃盤予定', 432, y, 40)]
    })].reverse().map(item => {
      const [, , , , x, y] = item.transform
      const origin = rotation === 90 ? [500 - y, x] : rotation === 180 ? [660 - x, 500 - y] : [y, 660 - x]
      return { ...item, transform: [...item.transform.slice(0, 4), ...origin] }
    })
    const rows = parseSupplierQuotePdfPage(cells, '', rotation)
    expect(rows.map(row => row.supplierResponseUnitPrice)).toEqual([4200, 3900])
    expect(matchSupplierQuotePdfRows([{ partNumber: 'F-01356' }], rows)[0].row.supplierResponseUnitPrice).toBe(4200)
  })

  it('画像の12明細を表の位置から抽出し、RFQに見える7品番と仕切単価が一致する', () => {
    const quote = [
      ['F-01356', 'ピンネイルＳ６－１２', '7,000', '4,900', '4,200', '廃盤予定'],
      ['F-01369', 'ピンネイルＳ６－１５', '7,000', '4,900', '4,200'],
      ['F-01372', 'ピンネイルＳ６－１８', '7,200', '5,040', '4,300'],
      ['F-00013', 'ピンネイルＰ１８', '1,200', '840', '700'],
      ['F-01385', 'ピンネイルＳ６－２２', '7,900', '5,530', '4,700', '廃盤予定'],
      ['F-01398', 'ピンネイルＳ６－２５', '8,900', '6,230', '5,300', '廃盤予定'],
      ['F-00026', 'ピンネイルＰ２５', '1,300', '910', '750'],
      ['F-01819', 'ピンネイルＰ３０', '1,400', '980', '800'],
      ['F-00055', 'ピンネイルＰ３５', '1,500', '1,050', '900'],
      ['F-02088', 'ピンネイルＰ４５', '1,600', '1,120', '950'],
      ['F-02136', 'ピンネイルＰ５０', '1,900', '1,330', '1,100'],
      ['VC004GZ', '充電式集じん機', '93,800', '65,660', '59,040'],
    ]
    const cells = quote.flatMap(([part, name, list, reference, net, note], index) => {
      const y = 282 - index * 16
      return [cell(String(index + 1), 48, y, 12), cell(part, 72, y, 45), cell(name, 132, y, 105),
        ...[list, reference, net].map((str, i) => cell(str, 307 + 60 * i - str.length * 5, y + 1, str.length * 5)),
        cell(note ?? '', 432, y, 40)]
    })
    const rows = parseSupplierQuotePdfPage([...compactHead, ...cells].reverse(), '')
    expect(rows).toEqual(quote.map(([partNumber, , , , net]) => ({ partNumber, supplierResponseUnitPrice: Number(net.replaceAll(',', '')) })))
    const items = quote.slice(0, 7).map(([partNumber]) => ({ partNumber }))
    expect(matchSupplierQuotePdfRows(items, rows).map(({ row }) => row.supplierResponseUnitPrice)).toEqual([4200, 4200, 4300, 700, 4700, 5300, 750])
  })

  it('簡易表の仕切単価が空欄・不正なら、隣の金額や数字の備考を採用しない', () => {
    const row = [cell('1', 50, 282, 5), cell('F-01356', 72, 282, 40), cell('ピン 6 12', 132, 282, 55),
      cell('7,000', 283, 282, 24), cell('4,900', 343, 282, 24), cell('123', 432, 282, 15)]
    expect(parseSupplierQuotePdfPage([...compactHead, ...row], '')).toEqual([])
    expect(parseSupplierQuotePdfPage([...compactHead, ...row, cell('4,2', 410, 282, 17)], '')).toEqual([])
    expect(parseSupplierQuotePdfPage([...compactHead, ...row, cell('4,200 廃盤予定', 402, 282, 64)], '')).toEqual([
      { partNumber: 'F-01356', supplierResponseUnitPrice: 4200 },
    ])
  })

  it('従来書式のページでは従来の金額・数量列を読む', () => {
    expect(parseSupplierQuotePdfPage([], '1 TEST 商品 7,000 4,900 9,800 4,200 8,400 2')).toEqual([
      { partNumber: 'TEST', supplierResponseUnitPrice: 4200 },
    ])
  })

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
