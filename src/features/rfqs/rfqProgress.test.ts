import { describe, expect, it } from 'vitest'
import { areAllRfqItemsQuoted, getRfqDisplayStatus, rfqDisplayStatusLabels } from './rfqProgress'
import { RFQ_STATUSES } from './rfqSchema'

describe('RFQ案件の見積進捗', () => {
  it('品目が未登録・全件削除・全件取消の場合は取得中とする', () => {
    for (const items of [[], [{ status: 'quoted', archivedAt: 'deleted' }], [{ status: 'cancelled' }]]) {
      expect(areAllRfqItemsQuoted(items)).toBe(false)
    }
  })
  it('すべての有効品目が見積取得済みになったら取得済とする', () => {
    expect(areAllRfqItemsQuoted([{ status: 'quoted', archivedAt: null }, { status: 'quoted' }])).toBe(true)
    expect(getRfqDisplayStatus('received', { allItemsQuoted: true, freeeTransferred: false })).toBe('quotes_received')
  })
  it.each(['pending', 'sourcing', 'candidates_listed', 'no_search_results', '', 'unknown'])('未見積品目が1件でもあれば取得中にする: %s', status => {
    const allItemsQuoted = areAllRfqItemsQuoted([{ status: 'quoted' }, { status }])
    expect(getRfqDisplayStatus('quoting', { allItemsQuoted, freeeTransferred: false })).toBe('collecting_quotes')
  })
  it('削除・取消済み品目は判定から除外する', () => {
    expect(areAllRfqItemsQuoted([{ status: 'quoted' }, { status: 'pending', archivedAt: 'deleted' }, { status: 'cancelled' }])).toBe(true)
  })
  it('発注・入荷へ進んだ品目は見積取得済みとして扱う', () => {
    expect(areAllRfqItemsQuoted([{ status: 'quoted' }, { status: 'ordered' }, { status: 'received' }])).toBe(true)
  })
  it.each([false, true])('freee転記成功は品目状態より優先する: 全件見積=%s', allItemsQuoted => {
    expect(getRfqDisplayStatus('received', { allItemsQuoted, freeeTransferred: true })).toBe('quote_created')
  })
  it('完了はfreee転記と品目状態より優先し、未取得でも表示できる', () => {
    expect(getRfqDisplayStatus('completed', { allItemsQuoted: true, freeeTransferred: true })).toBe('completed')
    expect(getRfqDisplayStatus('completed')).toBe('completed')
  })
  it('キャンセル案件は従来の表示を維持する', () => {
    expect(getRfqDisplayStatus('cancelled', { allItemsQuoted: true, freeeTransferred: true })).toBe('cancelled')
  })
  it('既存の手動進捗だけでは見積取得済・作成済と判定しない', () => {
    for (const status of RFQ_STATUSES.filter(status => !['completed', 'cancelled'].includes(status))) {
      expect(getRfqDisplayStatus(status, { allItemsQuoted: false, freeeTransferred: false })).toBe('collecting_quotes')
      expect(getRfqDisplayStatus(status)).toBeNull()
    }
  })
  it('指定された4段階の文言で表示する', () => {
    expect(['collecting_quotes', 'quotes_received', 'quote_created', 'completed'].map(status => rfqDisplayStatusLabels[status as keyof typeof rfqDisplayStatusLabels])).toEqual(['見積取得中', '見積取得済', '見積作成済', '完了'])
  })
})
