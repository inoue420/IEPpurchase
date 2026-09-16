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
import { appendRfqItemEcPurchaseCandidates, createRfqItem, saveRfqItemTranslation, setRfqItemArchived, setRfqItemSourcingTargets, updateRfqItem } from './rfqItemRepository'
const input = { originalDescription: ' Bolt ', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: '', partNumber: '', productName: '', quantity: 2, unit: '個', supplierQuoteRequestEnabled: true, marketplaceOfferEnabled: true, ecPurchaseCandidates: [], requestedDeliveryDate: '2026-09-08', status: 'pending' as const, note: '' }
describe('RFQ品目保存', () => {
  beforeEach(() => vi.clearAllMocks())
  it('翻訳は指定品目の訳文のみ更新する', async () => {
    mock.get.mockResolvedValue({ exists: () => true, data: () => ({ originalDescription: '原文', translatedDescription: '旧訳', archivedAt: null }) })
    await saveRfqItemTranslation('rfq-a', 'item-a', '原文', 'New translation', '旧訳')
    expect(mock.update).toHaveBeenCalledWith('rfqs/rfq-a/items/item-a', { translatedDescription: 'New translation', updatedAt: 'server-time' })
  })
  it.each([{ originalDescription: '変更' }, { translatedDescription: '変更' }, { archivedAt: 'deleted' }, { status: 'cancelled' }])('実行中に変更・削除・取消された品目を上書きしない: %j', async change => {
    mock.get.mockResolvedValue({ exists: () => true, data: () => ({ originalDescription: '原文', translatedDescription: '旧訳', archivedAt: null, ...change }) })
    await expect(saveRfqItemTranslation('rfq-a', 'item-a', '原文', 'New', '旧訳')).rejects.toThrow()
    expect(mock.update).not.toHaveBeenCalled()
  })
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
  it('一括検索の候補は既存候補を残して空き枠だけに追加する', async () => {
    mock.get.mockResolvedValue({ exists: () => true, data: () => ({ archivedAt: null, status: 'pending', ecPurchaseCandidates: [{ storeProductName: '既存', url: 'https://example.test/existing', price: 100, purchasePlanned: true }] }) })
    const added = await appendRfqItemEcPurchaseCandidates('rfq-a', 'item-a', [{ storeProductName: '新規', url: 'https://example.test/new', price: 200, purchasePlanned: false }, { storeProductName: '重複', url: 'https://example.test/existing', price: 100, purchasePlanned: false }])
    expect(added).toBe(1)
    expect(mock.update).toHaveBeenCalledWith('rfqs/rfq-a/items/item-a', { ecPurchaseCandidates: [{ storeProductName: '既存', url: 'https://example.test/existing', price: 100, purchasePlanned: true }, { storeProductName: '新規', url: 'https://example.test/new', price: 200, purchasePlanned: false }], updatedAt: 'server-time' })
  })
  it('一覧から対応先だけを安全に切り替える', async () => {
    mock.get.mockResolvedValue({ exists: () => true, data: () => ({ archivedAt: null }) })
    await setRfqItemSourcingTargets('rfq-a', 'item-a', true, false)
    expect(mock.update).toHaveBeenLastCalledWith('rfqs/rfq-a/items/item-a', { supplierQuoteRequestEnabled: true, marketplaceOfferEnabled: false, updatedAt: 'server-time' })
    await expect(setRfqItemSourcingTargets('rfq-a', 'item-a', false, false)).rejects.toThrow('対応先を1つ以上選択してください。')
  })
})
