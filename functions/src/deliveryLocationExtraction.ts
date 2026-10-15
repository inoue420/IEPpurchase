import { deliveryLocationName, normalizeDeliveryLocation } from './deliveryLocationModel'

const label = '(?:納品場所|納入場所|納品先|納入先|お届け先|delivery\\s*location|ship\\s*to)'
const labeledLine = new RegExp(`^\\s*${label}\\s*(?:[:：=＝|｜\\t]\\s*|\\s+|$)(.*)$`, 'iu')
const nextField = /(?:\t|\s*[|｜]\s*|\s+(?=(?:希望納期|納期|見積期限|担当者|備考|数量|電話|TEL|FAX)\s*[:：]))/iu
function valueAt(lines: string[], index: number): { name: string; nextLine: boolean } | null {
  // A delivery column can be the first column of a table. It is not a header
  // field whose value is the next column's title.
  if (lines[index].split(/[\t|]/u).slice(1).some(cell => /^(?:メーカー名?|品番|型番|詳細|商品名|品名|数量|単位|備考|qty|quantity|description)$/iu.test(cell.trim()))) return null
  const match = lines[index].match(labeledLine)
  if (!match) return null
  const nextLine = !match[1].trim()
  const raw = (nextLine ? lines[index + 1] ?? '' : match[1]).trim().split(nextField)[0].trim()
  if (!raw || /^(?:[-—―ー]|未定|指定なし|別途|同上|n\/a)$/iu.test(raw) || /^(?:[^:：]{1,30}[:：]|(?:希望納期|納期|品番|数量|備考|担当者)$)/u.test(raw)) return null
  try { return { name: deliveryLocationName(raw), nextLine } } catch { return null }
}
export function extractDeliveryLocationCandidates(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), candidates = new Map<string, string>()
  lines.forEach((_, index) => { const found = valueAt(lines, index); if (found) candidates.set(normalizeDeliveryLocation(found.name), found.name) })
  // RFQ tables may carry a delivery-location column instead of a header field.
  lines.forEach((line, index) => {
    const delimiter = line.includes('\t') ? '\t' : line.includes('|') ? '|' : ','
    const headers = line.split(delimiter).map(cell => cell.trim())
    const column = headers.findIndex(cell => new RegExp(`^${label}$`, 'iu').test(cell))
    if (column < 0 || headers.length < 2) return
    for (const row of lines.slice(index + 1)) {
      const cells = row.split(delimiter)
      if (cells.length !== headers.length) break
      try { const name = deliveryLocationName(cells[column]); if (name) candidates.set(normalizeDeliveryLocation(name), name) } catch { /* Invalid extraction remains unselected. */ }
    }
  })
  return [...candidates.values()]
}
export function withoutDeliveryLocationHeader(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), excluded = new Set<number>()
  lines.forEach((_, index) => { const found = valueAt(lines, index); if (found) { excluded.add(index); if (found.nextLine) excluded.add(index + 1) } })
  return lines.filter((_, index) => !excluded.has(index)).join('\n')
}
