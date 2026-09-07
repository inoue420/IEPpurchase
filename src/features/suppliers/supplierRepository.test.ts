import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ addDoc: vi.fn(), updateDoc: vi.fn() }))
vi.mock('../../firebase/firebase', () => ({ firestore: 'test-db' }))
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: (_db: unknown, path: string) => path,
  doc: (_db: unknown, path: string, id: string) => `${path}/${id}`,
  addDoc: mock.addDoc,
  updateDoc: mock.updateDoc,
  serverTimestamp: () => 'server-timestamp',
}))

import { createSupplier, setSupplierActive, updateSupplier } from './supplierRepository'

const input = { name: ' テスト商事 ', contactName: '', email: '', phone: '', postalCode: '', address: '', notes: '' }

describe('仕入先保存', () => {
  beforeEach(() => vi.clearAllMocks())
  it('suppliersへ正規化して登録し、サーバー日時を使う', async () => {
    await createSupplier(input)
    expect(mock.addDoc).toHaveBeenCalledWith('suppliers', {
      ...input, name: 'テスト商事', active: true, archivedAt: null,
      createdAt: 'server-timestamp', updatedAt: 'server-timestamp',
    })
  })
  it('編集では作成日時・有効状態を上書きしない', async () => {
    await updateSupplier('supplier-1', input)
    expect(mock.updateDoc).toHaveBeenCalledWith('suppliers/supplier-1', {
      ...input, name: 'テスト商事', updatedAt: 'server-timestamp',
    })
  })
  it('無効化で情報を残し、再有効化で無効化日時を解除する', async () => {
    await setSupplierActive('supplier-1', false)
    expect(mock.updateDoc).toHaveBeenLastCalledWith('suppliers/supplier-1', {
      active: false, archivedAt: 'server-timestamp', updatedAt: 'server-timestamp',
    })
    await setSupplierActive('supplier-1', true)
    expect(mock.updateDoc).toHaveBeenLastCalledWith('suppliers/supplier-1', {
      active: true, archivedAt: null, updatedAt: 'server-timestamp',
    })
  })
  it('不正な入力ではFirestoreを呼び出さない', async () => {
    await expect(createSupplier({ ...input, name: '　' })).rejects.toThrow()
    await expect(updateSupplier('supplier-1', { ...input, email: 'invalid' })).rejects.toThrow()
    expect(mock.addDoc).not.toHaveBeenCalled()
    expect(mock.updateDoc).not.toHaveBeenCalled()
  })
  it('保存失敗を画面側へ伝える', async () => {
    mock.addDoc.mockRejectedValueOnce(new Error('offline'))
    await expect(createSupplier(input)).rejects.toThrow('offline')
  })
})
