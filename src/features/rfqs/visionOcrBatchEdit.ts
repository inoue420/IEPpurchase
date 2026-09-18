import type { RfqItemInput } from './rfqItemRepository'
import { validateBulkRfqItemInput, type BulkRfqItemDraft } from './bulkRfqItemParser'

export type VisionOcrColumnKey = 'manufacturerName' | 'partNumber' | 'originalDescription' | 'quantity' | 'unit'
export type VisionOcrBatchAction = 'copy' | 'move' | 'clear'
export type VisionOcrBatchScope = 'selected' | 'all'

export const visionOcrColumns: { key: VisionOcrColumnKey; label: string }[] = [
  { key: 'manufacturerName', label: 'メーカー' },
  { key: 'partNumber', label: '品番' },
  { key: 'originalDescription', label: '品目説明' },
  { key: 'quantity', label: '数量' },
  { key: 'unit', label: '単位' },
]

function emptyValue(key: VisionOcrColumnKey): string | number {
  return key === 'quantity' ? Number.NaN : ''
}

function valueFor(key: VisionOcrColumnKey, value: string | number): string | number {
  return key === 'quantity' && String(value).trim() ? Number(value) : key === 'quantity' ? Number.NaN : String(value)
}

function replaceValue(input: RfqItemInput, key: VisionOcrColumnKey, value: string | number): RfqItemInput {
  if (key === 'manufacturerName') return { ...input, manufacturerName: String(value) }
  if (key === 'partNumber') return { ...input, partNumber: String(value) }
  if (key === 'originalDescription') return { ...input, originalDescription: String(value) }
  if (key === 'quantity') return { ...input, quantity: Number(value) }
  return { ...input, unit: String(value) }
}

export function applyVisionOcrBatchEdit(
  rows: BulkRfqItemDraft[],
  selectedRowNumbers: number[],
  action: VisionOcrBatchAction,
  source: VisionOcrColumnKey,
  target: VisionOcrColumnKey | null,
  scope: VisionOcrBatchScope,
): { rows: BulkRfqItemDraft[]; selectedRowNumbers: number[]; affectedCount: number } {
  if ((action === 'copy' || action === 'move') && (!target || source === target)) {
    return { rows, selectedRowNumbers, affectedCount: 0 }
  }
  const affected = new Set(scope === 'all' ? rows.map(row => row.rowNumber) : selectedRowNumbers)
  const nextRows = rows.map(row => {
    if (!affected.has(row.rowNumber)) return row
    let input = row.input
    if (action === 'clear') input = replaceValue(input, source, emptyValue(source))
    else {
      input = replaceValue(input, target!, valueFor(target!, input[source]))
      if (action === 'move') input = replaceValue(input, source, emptyValue(source))
    }
    return { ...row, input, error: validateBulkRfqItemInput(input) }
  })
  const validRows = new Set(nextRows.filter(row => !row.error).map(row => row.rowNumber))
  return {
    rows: nextRows,
    selectedRowNumbers: selectedRowNumbers.filter(rowNumber => validRows.has(rowNumber)),
    affectedCount: affected.size,
  }
}
