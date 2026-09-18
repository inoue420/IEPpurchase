import type { RfqItemInput } from './rfqItemRepository'
import { rfqItemSchema } from './rfqItemSchema'
import * as XLSX from 'xlsx'

export interface BulkRfqItemDraft { rowNumber: number; input: RfqItemInput; error: string | null }

const aliases: Record<string, keyof Pick<RfqItemInput, 'manufacturerName' | 'partNumber' | 'productName' | 'originalDescription' | 'quantity' | 'unit' | 'note'>> = {
  'メーカー': 'manufacturerName', 'メーカー名': 'manufacturerName', manufacturer: 'manufacturerName', '品番': 'partNumber', '型番': 'partNumber', partnumber: 'partNumber', 'part no': 'partNumber',
  '商品名': 'productName', '品名': 'productName', productname: 'productName', description: 'originalDescription', '詳細': 'originalDescription', '品目説明': 'originalDescription', '内容': 'originalDescription',
  '数量': 'quantity', qty: 'quantity', quantity: 'quantity', '単位': 'unit', unit: 'unit', '備考': 'note', note: 'note',
}
const normalized = (value: string) => value.replace(/[\s\u3000]/g, '').toLowerCase()
function blankInput(): RfqItemInput { return { originalDescription: '', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: '', partNumber: '', productName: '', quantity: 1, supplierResponseUnitPrice: null, unit: '個', supplierQuoteRequestEnabled: true, marketplaceOfferEnabled: true, ecPurchaseCandidates: [], requestedDeliveryDate: '', status: 'pending', note: '' } }

function splitRow(line: string, delimiter: string): string[] {
  const source = delimiter === '|' ? line.replace(/^\s*\|/, '').replace(/\|\s*$/, '') : line
  return source.split(delimiter).map(value => value.trim())
}

function splitDataRow(line: string, delimiter: string, headerCount: number): string[] {
  const values = splitRow(line, delimiter)
  // Mail clients often preserve a visual table as aligned spaces while leaving
  // the header comma-separated. Only use that fallback when it has exactly the
  // same number of columns, so descriptions containing ordinary spaces remain intact.
  if (values.length === 1 && headerCount > 1) {
    const spaced = line.trim().split(/(?:\s{2,}|\u3000+)/).map(value => value.trim())
    if (spaced.length === headerCount) return spaced
  }
  return values
}

export function validateBulkRfqItemInput(input: RfqItemInput): string | null {
  const result = rfqItemSchema.safeParse(input)
  return result.success ? null : result.error.issues[0]?.message ?? '入力内容を確認してください。'
}

export function parseBulkRfqItems(text: string): BulkRfqItemDraft[] {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes('|') ? '|' : lines[0].includes(',') ? ',' : '、'
  const headers = splitRow(lines[0], delimiter).map(value => aliases[normalized(value)])
  if (!headers.some(Boolean)) return []
  return lines.slice(1, 51).map((line, index) => {
    const input = blankInput()
    splitDataRow(line, delimiter, headers.length).forEach((value, column) => { const key = headers[column]; if (!key) return; if (key === 'quantity') input.quantity = Number(value); else input[key] = value })
    if (!input.originalDescription) input.originalDescription = input.productName || [input.manufacturerName, input.partNumber].filter(Boolean).join(' ')
    const values = splitDataRow(line, delimiter, headers.length)
    if (!values[headers.indexOf('quantity')]?.trim()) input.quantity = Number.NaN
    if (!values[headers.indexOf('unit')]?.trim()) input.unit = ''
    if (!values[headers.indexOf('originalDescription')]?.trim()) input.originalDescription = ''

    const error = validateBulkRfqItemInput(input)
    return { rowNumber: index + 2, input, error }
  })
}

export interface BulkRfqItemFilePreview { text: string; sheetName: string; dataRowCount: number }
const supportedFileName = /\.(csv|xlsx|xls)$/i
export function parseBulkRfqItemFileData(fileName: string, data: ArrayBuffer): BulkRfqItemFilePreview {
  if (!supportedFileName.test(fileName)) throw new Error('CSV、Excel（.xlsx / .xls）ファイルを選択してください。')
  let workbook: XLSX.WorkBook
  try { workbook = XLSX.read(data, { type: 'array' }) } catch { throw new Error('ファイルを読み取れませんでした。CSVまたはExcelファイルか確認してください。') }
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('読み取れるシートがありません。')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false })
  const nonEmptyRows = rows.filter(row => row.some(value => String(value).trim() !== ''))
  if (nonEmptyRows.length < 2) throw new Error('見出しと少なくとも1件の品目が必要です。')
  const text = nonEmptyRows.map(row => row.map(value => String(value).replace(/[\t\r\n]/g, ' ')).join('\t')).join('\n')
  return { text, sheetName, dataRowCount: nonEmptyRows.length - 1 }
}
export async function readBulkRfqItemFile(file: File): Promise<BulkRfqItemFilePreview> {
  if (file.size > 10 * 1024 * 1024) throw new Error('ファイルは10MB以下にしてください。')
  return parseBulkRfqItemFileData(file.name, await file.arrayBuffer())
}
