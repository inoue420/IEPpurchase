import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { Timestamp, doc, getDoc, writeBatch } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setRfqItemSupplierResponseUnitPrices } from '../../src/features/rfqs/rfqItemRepository'

const connection = vi.hoisted(() => ({ firestore: null as unknown }))
vi.mock('../../src/firebase/firebase', () => ({ get firestore() { return connection.firestore } }))
let env: RulesTestEnvironment
const past = Timestamp.fromMillis(1700000000000)
const states = ['pending', 'sourcing', 'candidates_listed', 'no_search_results', 'quoted', 'ordered', 'received', 'cancelled', 'archived']
const db = () => env.authenticatedContext('member').firestore()

beforeAll(async () => {
  const address = process.env.FIRESTORE_EMULATOR_HOST
  if (!address || !/^(localhost|127\.0\.0\.1):\d+$/.test(address)) throw new Error('Local emulator required; no production access.')
  const [host, port] = address.split(':')
  env = await initializeTestEnvironment({ projectId: 'demo-ieppurchase-pdf-import', firestore: { host, port: Number(port), rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } })
})
beforeEach(async () => {
  await env.clearFirestore()
  connection.firestore = db()
  await env.withSecurityRulesDisabled(async context => {
    const batch = writeBatch(context.firestore())
    batch.set(doc(context.firestore(), 'rfqs/rfq'), { subject: 'PDF import regression' })
    states.forEach((state, index) => batch.set(doc(context.firestore(), 'rfqs/rfq/items', state), {
      lineNo: index + 1, originalDescription: 'バッテリ', translatedDescription: 'Battery', productId: '', manufacturerId: '', manufacturerName: 'マキタ', partNumber: 'BL1860B', productName: '', quantity: 2, unit: '個',
      supplierResponseUnitPrice: 100, supplierQuoteRequestEnabled: true, marketplaceOfferEnabled: true, ecPurchaseCandidates: [], requestedDeliveryDate: null,
      status: state === 'archived' ? 'pending' : state, note: 'Keep existing data', archivedAt: state === 'archived' ? past : null, createdAt: past, updatedAt: past,
    }))
    await batch.commit()
  })
})
afterAll(async () => env?.cleanup())

describe('PDF取込の単価・状態を既存Rulesと実リポジトリで保存', () => {
  it('選択した全品目の単価・見積取得済みを保存し、未選択品目と既存フィールドを保持する', async () => {
    await setRfqItemSupplierResponseUnitPrices('rfq', states.slice(0, 5).map((itemId, index) => ({ itemId, supplierResponseUnitPrice: index === 0 ? 0 : 15400 })))
    for (const itemId of states.slice(0, 5)) {
      const saved = (await getDoc(doc(db(), 'rfqs/rfq/items', itemId))).data()!
      expect(saved).toMatchObject({ status: 'quoted', supplierResponseUnitPrice: itemId === 'pending' ? 0 : 15400, quantity: 2, unit: '個', translatedDescription: 'Battery', note: 'Keep existing data', createdAt: past })
      expect(saved.updatedAt.toMillis()).toBeGreaterThan(past.toMillis())
    }
    expect((await getDoc(doc(db(), 'rfqs/rfq/items/ordered'))).data()).toMatchObject({ status: 'ordered', supplierResponseUnitPrice: 100, updatedAt: past })
  })

  it('進んだ状態を保持し、単価のみ反映する', async () => {
    await setRfqItemSupplierResponseUnitPrices('rfq', ['ordered', 'received'].map(itemId => ({ itemId, supplierResponseUnitPrice: 15400 })))
    for (const itemId of ['ordered', 'received']) expect((await getDoc(doc(db(), 'rfqs/rfq/items', itemId))).data()).toMatchObject({ status: itemId, supplierResponseUnitPrice: 15400 })
  })

  it.each(['missing', 'archived', 'cancelled'])('無効な対象がある場合は有効品目も変更しない: %s', async itemId => {
    await expect(setRfqItemSupplierResponseUnitPrices('rfq', [{ itemId: 'pending', supplierResponseUnitPrice: 12510 }, { itemId, supplierResponseUnitPrice: 15400 }])).rejects.toThrow('変更または削除')
    expect((await getDoc(doc(db(), 'rfqs/rfq/items/pending'))).data()).toMatchObject({ status: 'pending', supplierResponseUnitPrice: 100, updatedAt: past })
  })

  it('未認証の取込は拒否し、保存済みの単価・状態を変更しない', async () => {
    connection.firestore = env.unauthenticatedContext().firestore()
    await expect(setRfqItemSupplierResponseUnitPrices('rfq', [{ itemId: 'pending', supplierResponseUnitPrice: 12510 }])).rejects.toThrow()
    expect((await getDoc(doc(db(), 'rfqs/rfq/items/pending'))).data()).toMatchObject({ status: 'pending', supplierResponseUnitPrice: 100 })
  })
})
