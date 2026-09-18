import { describe, expect, it } from 'vitest'
import { parseBulkRfqItems } from './bulkRfqItemParser'
import * as XLSX from 'xlsx'
import { parseBulkRfqItemFileData } from './bulkRfqItemParser'
describe('一括品目貼り付け', () => {
  it('タブ区切りのヘッダー付き表を品目入力へ変換する', () => {
    const rows = parseBulkRfqItems('メーカー名\t品番\t詳細\t数量\t単位\t備考\nABC\tA-1\tボルト\t2\t本\t至急')
    expect(rows[0]).toMatchObject({ rowNumber: 2, error: null, input: { manufacturerName: 'ABC', partNumber: 'A-1', originalDescription: 'ボルト', quantity: 2, unit: '本', note: '至急' } })
  })
  it('詳細列がない場合は説明を空欄としてエラー表示する', () => expect(parseBulkRfqItems('品番|商品名|数量|単位\nA-1|六角ボルト|3|個')[0]).toMatchObject({ error: '品目説明を入力してください。', input: { originalDescription: '' } }))
  it('両端のパイプを含むメール表を読み取る', () => expect(parseBulkRfqItems('| メーカー | 型番 | 内容 | 数量 | 単位 |\n| ABC | A-1 | ボルト | 3 | 本 |')[0]).toMatchObject({ error: null, input: { manufacturerName: 'ABC', partNumber: 'A-1', originalDescription: 'ボルト', quantity: 3, unit: '本' } }))
  it('カンマの見出しと空白揃えのメール本文を列ごとに読み取る', () => {
    const rows = parseBulkRfqItems('メーカー、品番、数量\nパナソニック  NNY24937 LF9  15\nパナソニック  NYS15340K LE9  15')
    expect(rows).toMatchObject([
      { error: '品目説明を入力してください。', input: { manufacturerName: 'パナソニック', partNumber: 'NNY24937 LF9', quantity: 15 } },
      { error: '品目説明を入力してください。', input: { manufacturerName: 'パナソニック', partNumber: 'NYS15340K LE9', quantity: 15 } },
    ])
  })
  it('既存品目と同じ入力制約をプレビューにも適用する', () => expect(parseBulkRfqItems('詳細,数量,単位\nボルト,0,個')[0]?.error).toBe('数量は0より大きい数値を入力してください。'))
})
  it('Excelの先頭シートを一括登録用の表へ変換する', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['メーカー名', '品番', '詳細', '数量', '単位'], ['ABC', 'A-1', 'ボルト', 2, '本']]), '品目')
    const preview = parseBulkRfqItemFileData('items.xlsx', XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
    expect(preview).toMatchObject({ sheetName: '品目', dataRowCount: 1 })
    expect(parseBulkRfqItems(preview.text)[0]).toMatchObject({ error: null, input: { manufacturerName: 'ABC', partNumber: 'A-1', originalDescription: 'ボルト', quantity: 2, unit: '本' } })
  })
  it('対象外の拡張子を拒否する', () => expect(() => parseBulkRfqItemFileData('items.pdf', new ArrayBuffer(0))).toThrow('CSV、Excel'))
it('列順に依存せず、欠落した項目は空欄としてプレビューする', () => {
  const row = parseBulkRfqItems('単位,品番,メーカー名\n, A-1, ABC')[0]
  expect(row?.input.unit).toBe('')
  expect(row?.input.originalDescription).toBe('')
  expect(Number.isNaN(row?.input.quantity)).toBe(true)
  expect(row?.input.partNumber).toBe('A-1')
  expect(row?.input.manufacturerName).toBe('ABC')
  expect(row?.error).toBe('品目説明を入力してください。')
})
