import type { RfqStatus } from './rfqSchema'

export type RfqDisplayStatus = 'collecting_quotes' | 'quotes_received' | 'quote_created' | 'completed' | 'cancelled'
export const rfqDisplayStatusLabels: Record<RfqDisplayStatus, string> = {
  collecting_quotes: '見積取得中',
  quotes_received: '見積取得済',
  quote_created: '見積作成済',
  completed: '完了',
  cancelled: 'キャンセル',
}

export interface RfqProgress { allItemsQuoted: boolean; freeeTransferred: boolean }

export function areAllRfqItemsQuoted(items: readonly { status: string; archivedAt?: unknown }[]): boolean {
  const activeItems = items.filter(item => item.archivedAt == null && item.status !== 'cancelled')
  return activeItems.length > 0 && activeItems.every(item => ['quoted', 'ordered', 'received'].includes(item.status))
}

export function getRfqDisplayStatus(status: RfqStatus, progress?: RfqProgress): RfqDisplayStatus | null {
  if (status === 'completed' || status === 'cancelled') return status
  if (!progress) return null
  if (progress.freeeTransferred) return 'quote_created'
  return progress.allItemsQuoted ? 'quotes_received' : 'collecting_quotes'
}
