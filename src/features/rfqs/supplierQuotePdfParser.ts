export interface SupplierQuotePdfRow {
  partNumber: string
  supplierResponseUnitPrice: number
}

export function normalizePartNumber(value: string): string {
  return value.normalize('NFKC').replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, '').toUpperCase()
}

export function parseSupplierQuotePdfText(text: string): SupplierQuotePdfRow[] {
  const rows = text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*\d+\s+(\S+)\s+.+?\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$/)
    if (!match) return []
    const supplierResponseUnitPrice = Number(match[5].replaceAll(',', ''))
    return Number.isSafeInteger(supplierResponseUnitPrice) && supplierResponseUnitPrice >= 0 ? [{ partNumber: match[1], supplierResponseUnitPrice }] : []
  })
  return rows
}
