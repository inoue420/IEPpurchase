import type { RfqItemInput } from './rfqItemRepository'
import { parseBulkRfqItems, type BulkRfqItemDraft } from './bulkRfqItemParser'

const unitPattern = '(個|本|枚|台|組|セット|箱|袋|巻|m|M|kg|KG|g|G|L|l)'
const blank = (): RfqItemInput => ({ originalDescription: '', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: '', partNumber: '', productName: '', quantity: 1, supplierResponseUnitPrice: null, unit: '個', supplierQuoteRequestEnabled: true, marketplaceOfferEnabled: true, ecPurchaseCandidates: [], requestedDeliveryDate: '', status: 'pending', note: '' })
export function parseVisionOcrItems(text: string): BulkRfqItemDraft[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(line => line.trim())
  const header = lines[0]?.split('\t').map(value => value.trim()) ?? []
  const hasQuantity = header.some(value => /^(数量|qty|quantity)$/i.test(value))
  const hasDescription = header.some(value => /^(製品名|商品名|品名|品目説明|詳細|内容|description)$/i.test(value))
  const hasUnit = header.some(value => /^(単位|unit)$/i.test(value))
  const guidedTable = hasQuantity && hasDescription
    ? [
        [...header.map(value => /^(製品名|商品名|品名)$/i.test(value) ? '詳細' : value), ...(hasUnit ? [] : ['単位'])].join('\t'),
        ...lines.slice(1).map(line => [line, ...(hasUnit ? [] : ['個'])].join('\t')),
      ].join('\n')
    : text
  const table = parseBulkRfqItems(guidedTable)
  if (table.length) return table.map(row => {
    if (row.input.partNumber) return row
    const part = row.input.originalDescription.match(/\b(?=[A-Z0-9._/-]*\d)(?=[A-Z0-9._/-]*[A-Z-])[A-Z0-9][A-Z0-9._/-]{2,}\b/i)
    return part ? { ...row, input: { ...row.input, partNumber: part[0] } } : row
  })
  return text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 50).map((line, index) => {
    const input = blank(); const quantity = line.match(new RegExp(`(?:^|\\s)(\\d+(?:\\.\\d+)?)\\s*${unitPattern}(?:\\s|$)`))
    if (quantity) { input.quantity = Number(quantity[1]); input.unit = quantity[2]; input.originalDescription = line.slice(0, quantity.index).trim() || line } else input.originalDescription = line
    const part = input.originalDescription.match(/\b(?=[A-Z0-9._/-]*\d)(?=[A-Z0-9._/-]*[A-Z-])[A-Z0-9][A-Z0-9._/-]{2,}\b/i); if (part) input.partNumber = part[0]
    return { rowNumber: index + 1, input, error: input.originalDescription ? null : '文字を確認してください。' }
  })
}
