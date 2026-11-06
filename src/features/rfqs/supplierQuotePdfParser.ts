export interface SupplierQuotePdfRow {
  partNumber: string
  supplierResponseUnitPrice: number
}

export function normalizePartNumber(value: string): string {
  return value.normalize('NFKC').replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, '').toUpperCase()
}

export function parseSupplierQuotePdfText(text: string): SupplierQuotePdfRow[] {
  const rows = text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*\d+\s+(\S+)\s+.+?\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)(?:\s+.*)?$/)
    if (!match) return []
    const supplierResponseUnitPrice = Number(match[5].replaceAll(',', ''))
    return Number.isSafeInteger(supplierResponseUnitPrice) && supplierResponseUnitPrice >= 0 ? [{ partNumber: match[1], supplierResponseUnitPrice }] : []
  })
  return rows
}

export function matchSupplierQuotePdfRows<Item extends { partNumber: string }>(items: Item[], rows: SupplierQuotePdfRow[]): { item: Item; row: SupplierQuotePdfRow }[] {
  return items.flatMap(item => {
    // PDFのページ・行順を維持し、同じ品番では最初の行を優先する。
    const row = rows.find(candidate => normalizePartNumber(candidate.partNumber) === normalizePartNumber(item.partNumber))
    return row ? [{ item, row }] : []
  })
}
