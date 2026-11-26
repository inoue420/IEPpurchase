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

// PDF.js may emit cells in column order or mark individual cells as line endings.
interface PdfTextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

function visualLines(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = items.filter(item => item.str.trim()).sort((a, b) => b.transform[5] - a.transform[5])
  const lines: PdfTextItem[][] = []
  for (const item of sorted) {
    const line = lines.at(-1)
    if (line && Math.abs(line[0].transform[5] - item.transform[5]) <= Math.min(line[0].height, item.height) * 0.4) {
      line.push(item)
    } else {
      lines.push([item])
    }
  }
  return lines.map(line => line.sort((a, b) => a.transform[4] - b.transform[4]))
}

function compactHeader(line: PdfTextItem[]) {
  const headings = ['品番', '品名', '定価', '参考売価', '仕切単価']
  const characters = line.flatMap(item => {
    const chars = Array.from(item.str.normalize('NFKC'))
    return chars.map((char, index) => ({
      char, x: item.transform[4] + item.width * (index + 0.5) / chars.length,
    })).filter(({ char }) => char.trim())
  })
  const labels = characters.map(({ char }) => char).join('')
  if (!labels.includes(headings.join(''))) return null
  function center(label: string) {
    const start = labels.indexOf(label)
    return (characters[start].x + characters[start + label.length - 1].x) / 2
  }
  // This form has three adjacent, equal-width price columns with centered headings.
  const list = center('定価'), reference = center('参考売価'), net = center('仕切単価')
  return { left: (reference + net) / 2, right: net + (net - reference) / 2, priceStart: list - (reference - list) / 2 }
}

export function parseSupplierQuotePdfPage(items: PdfTextItem[], text: string): SupplierQuotePdfRow[] {
  const lines = visualLines(items)
  let columns: ReturnType<typeof compactHeader> = null
  const rows: SupplierQuotePdfRow[] = []
  for (const line of lines) {
    if (line.some(item => item.str.includes('品'))) {
      const header = compactHeader(line)
      if (header) {
        columns = header
        continue
      }
    }
    if (!columns) continue
    const { left, right, priceStart } = columns
    const description = line.filter(item => item.transform[4] < priceStart).map(item => item.str.trim()).join(' ')
    const match = description.match(/^\s*[0-9０-９]+\s+(\S+)\s+\S/)
    if (!match) continue
    const fragments = line.filter(item => item.transform[4] >= left && item.transform[4] < right)
      .map(item => {
        const str = item.str.trim()
        if (item.transform[4] + item.width <= right) return str
        // PDF.js can merge the right-aligned price and the adjacent note into one run.
        return str.match(/^(\S+)\s+\S/)?.[1]
      })
    if (fragments.includes(undefined)) continue
    const price = fragments.join('').normalize('NFKC')
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(price)) continue
    const supplierResponseUnitPrice = Number(price.replaceAll(',', ''))
    if (Number.isSafeInteger(supplierResponseUnitPrice)) rows.push({ partNumber: match[1], supplierResponseUnitPrice })
  }
  return columns ? rows : parseSupplierQuotePdfText(text)
}

export function matchSupplierQuotePdfRows<Item extends { partNumber: string }>(items: Item[], rows: SupplierQuotePdfRow[]): { item: Item; row: SupplierQuotePdfRow }[] {
  return items.flatMap(item => {
    // PDFのページ・行順を維持し、同じ品番では最初の行を優先する。
    const row = rows.find(candidate => normalizePartNumber(candidate.partNumber) === normalizePartNumber(item.partNumber))
    return row ? [{ item, row }] : []
  })
}
