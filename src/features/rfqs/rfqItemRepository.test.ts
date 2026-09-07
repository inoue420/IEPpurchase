import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), update: vi.fn() }))
vi.mock('../../firebase/firebase', () => ({ firestore: 'db' }))
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (base: unknown, ...parts: string[]) => parts.length ? parts.join('/') : String(base) + '/auto-id',
  runTransaction: (_db: unknown, work: (tx: typeof mock) => Promise<void>) => work(mock),
  serverTimestamp: () => 'server-time',
}))
import { createRfqItem, setRfqItemArchived, updateRfqItem } from './rfqItemRepository'
const input = { originalDescription: ' Bolt ', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: '', partNumber: '', productName: '', quantity: 2, unit: '個', requestedDeliveryDate: '2026-09-08', status: 'pending' as const, note: '' }
describe('RFQ品目保存', () => {
  beforeEach(() => vi.clearAllMocks())
  it('親案件とカウンターを読み、同一トランザクションで次の明細を保存する', async () => {
    mock.get.mockResolvedValueOnce({ exists: () => true }).mockResolvedValueOnce({ exists: () => true, data: () => ({ lastLineNo: 2 }) })
    await createRfqItem('rfq-a', input)
    expect(mock.get.mock.calls.map(call => call[0])).toEqual(['rfqs/rfq-a', 'rfqs/rfq-a/itemCounters/sequence'])
    expect(mock.set).toHaveBeenCalledWith('rfqs/rfq-a/itemCounters/sequence', { lastLineNo: 3, updatedAt: 'server-time' })
    expect(mock.set).toHaveBeenCalledWith('rfqs/rfq-a/items/auto-id', expect.objectContaining({ lineNo: 3, originalDescription: 'Bolt', createdAt: 'server-time', updatedAt: 'server-time', archivedAt: null }))
    const payload = mock.set.mock.calls[1][1]
    expect(payload.requestedDeliveryDate.toDate().getDate()).toBe(8)
  })
  it('初回の明細番号を1にする', async () => {
    mock.get.mockResolvedValueOnce({ exists: () => true }).mockResolvedValueOnce({ exists: () => false })
    await createRfqItem('rfq-a', input)
    expect(mock.set).toHaveBeenCalledWith('rfqs/rfq-a/items/auto-id', expect.objectContaining({ lineNo: 1 }))
  })
  it('親案件なし・不正入力では書き込まない', async () => {
    mock.get.mockResolvedValue({ exists: () => false })
    await expect(createRfqItem('missing', input)).rejects.toThrow()
    await expect(createRfqItem('rfq-a', { ...input, quantity: 0 })).rejects.toThrow()
    expect(mock.set).not.toHaveBeenCalled()
  })
  it('編集でID・番号・作成日時を変更しない', async () => {
    mock.get.mockResolvedValue({ exists: () => true, data: () => ({ archivedAt: null }) })
    await updateRfqItem('rfq-a', 'item-a', input)
    expect(mock.update.mock.calls[0][0]).toBe('rfqs/rfq-a/items/item-a')
    const payload = mock.update.mock.calls[0][1]
    expect(payload).not.toHaveProperty('lineNo')
    expect(payload).not.toHaveProperty('createdAt')
    expect(payload).not.toHaveProperty('id')
  })
  it('他の利用者が削除した品目への編集を拒否する', async () => {
    mock.get.mockResolvedValue({ exists: () => true, data: () => ({ archivedAt: 'archived' }) })
    await expect(updateRfqItem('rfq-a', 'item-a', input)).rejects.toThrow()
    expect(mock.update).not.toHaveBeenCalled()
  })
  it('削除・復元は同じIDを保持し日時だけを変更する', async () => {
    mock.get.mockResolvedValue({ exists: () => true })
    await setRfqItemArchived('rfq-a', 'item-a', true)
    expect(mock.update).toHaveBeenLastCalledWith('rfqs/rfq-a/items/item-a', { archivedAt: 'server-time', updatedAt: 'server-time' })
    await setRfqItemArchived('rfq-a', 'item-a', false)
    expect(mock.update).toHaveBeenLastCalledWith('rfqs/rfq-a/items/item-a', { archivedAt: null, updatedAt: 'server-time' })
  })
})
