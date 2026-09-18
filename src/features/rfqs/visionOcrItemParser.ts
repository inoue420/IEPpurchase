import type { RfqItemInput } from './rfqItemRepository'
import { parseBulkRfqItems, type BulkRfqItemDraft } from './bulkRfqItemParser'

const unitPattern = '(個|本|枚|台|組|セット|箱|袋|巻|m|M|kg|KG|g|G|L|l)'
const blank = (): RfqItemInput => ({ originalDescription: '', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: '', partNumber: '', productName: '', quantity: 1, supplierResponseUnitPrice: null, unit: '個', supplierQuoteRequestEnabled: true, marketplaceOfferEnabled: true, ecPurchaseCandidates: [], requestedDeliveryDate: '', status: 'pending', note: '' })
export function parseVisionOcrItems(text: string): BulkRfqItemDraft[] {
  const table = parseBulkRfqItems(text)
  if (table.length) return table
  return text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 50).map((line, index) => {
    const input = blank(); const quantity = line.match(new RegExp(`(?:^|\\s)(\\d+(?:\\.\\d+)?)\\s*${unitPattern}(?:\\s|$)`))
    if (quantity) { input.quantity = Number(quantity[1]); input.unit = quantity[2]; input.originalDescription = line.slice(0, quantity.index).trim() || line } else input.originalDescription = line
    const part = input.originalDescription.match(/\b(?=[A-Z0-9._/-]*\d)[A-Z0-9][A-Z0-9._/-]{2,}\b/i); if (part) input.partNumber = part[0]
    return { rowNumber: index + 1, input, error: input.originalDescription ? null : '文字を確認してください。' }
  })
}
