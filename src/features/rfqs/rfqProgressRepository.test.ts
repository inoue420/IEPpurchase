import { beforeEach, describe, expect, it, vi } from 'vitest'

interface TestSnapshot { docs: { data: () => Record<string, unknown> }[]; data: () => Record<string, unknown> | undefined }
const mock = vi.hoisted(() => ({ listeners: new Map<string, { next: (snapshot: TestSnapshot) => void; error: (error: Error) => void; stop: ReturnType<typeof vi.fn> }>() }))
vi.mock('../../firebase/firebase', () => ({ firestore: 'db' }))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  onSnapshot: (path: string, next: (snapshot: TestSnapshot) => void, error: (error: Error) => void) => {
    const stop = vi.fn()
    mock.listeners.set(path, { next, error, stop })
    return stop
  },
}))
import { subscribeRfqProgress } from './rfqProgressRepository'
import { getRfqDisplayStatus } from './rfqProgress'

const itemsPath = 'rfqs/rfq-a/items'
const exportPath = 'salesQuotes/rfq-a/freeeExports/current'
function emitItems(items: Record<string, unknown>[]) {
  mock.listeners.get(itemsPath)!.next({ docs: items.map(item => ({ data: () => item })), data: () => undefined })
}
function emitExport(status?: string) {
  mock.listeners.get(exportPath)!.next({ docs: [], data: () => status ? { status } : undefined })
}

describe('RFQ案件の進捗読込', () => {
  beforeEach(() => mock.listeners.clear())
  it('品目が先に届いてもfreeeの初回結果まで待ち、変更を反映する', () => {
    const change = vi.fn()
    const stop = subscribeRfqProgress('rfq-a', change, vi.fn())
    emitItems([{ status: 'pending' }])
    expect(change).not.toHaveBeenCalled()
    emitExport()
    expect(change).toHaveBeenLastCalledWith({ allItemsQuoted: false, freeeTransferred: false })
    emitItems([{ status: 'quoted' }])
    expect(change).toHaveBeenLastCalledWith({ allItemsQuoted: true, freeeTransferred: false })
    emitExport('sent')
    expect(change).toHaveBeenLastCalledWith({ allItemsQuoted: true, freeeTransferred: true })
    emitItems([{ status: 'pending' }])
    expect(getRfqDisplayStatus('received', change.mock.lastCall![0])).toBe('quote_created')
    stop()
  })
  it('freeeが先に届いた場合も品目の初回結果まで待つ', () => {
    const change = vi.fn()
    subscribeRfqProgress('rfq-a', change, vi.fn())
    emitExport('sent')
    expect(change).not.toHaveBeenCalled()
    emitItems([])
    expect(change).toHaveBeenLastCalledWith({ allItemsQuoted: false, freeeTransferred: true })
  })
  it.each(['draft', 'sending', 'failed', 'uncertain'])('保存・送信途中・拒否・結果不明を転記完了にしない: %s', status => {
    const change = vi.fn()
    subscribeRfqProgress('rfq-a', change, vi.fn())
    emitItems([{ status: 'quoted' }])
    emitExport(status)
    expect(getRfqDisplayStatus('received', change.mock.lastCall![0])).toBe('quotes_received')
  })
  it.each([itemsPath, exportPath])('読込失敗を報告し、他方の読込だけで進捗を確定しない: %s', path => {
    const change = vi.fn(), error = vi.fn(), cause = new Error('denied')
    subscribeRfqProgress('rfq-a', change, error)
    mock.listeners.get(path)!.error(cause)
    emitItems([{ status: 'quoted' }])
    emitExport('sent')
    expect(error).toHaveBeenCalledExactlyOnceWith(cause)
    expect(change).not.toHaveBeenCalled()
  })
  it('終了時に両方の購読を解除し、遅延した通知を反映しない', () => {
    const change = vi.fn(), error = vi.fn()
    const stop = subscribeRfqProgress('rfq-a', change, error)
    stop()
    expect(mock.listeners.get(itemsPath)!.stop).toHaveBeenCalledOnce()
    expect(mock.listeners.get(exportPath)!.stop).toHaveBeenCalledOnce()
    emitItems([{ status: 'quoted' }])
    emitExport('sent')
    mock.listeners.get(exportPath)!.error(new Error('late'))
    expect(change).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
