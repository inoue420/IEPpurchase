/// <reference types="vite/client" />
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch, type DocumentData } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateLine } from '../../src/features/supplierQuotes/quoteMoney'
import { saveSupplierQuoteItem } from '../../src/features/supplierQuotes/supplierQuoteItemRepository'
import { updateSupplierQuote } from '../../src/features/supplierQuotes/supplierQuoteRepository'

const connection = vi.hoisted(() => ({ firestore: null as unknown }))
vi.mock('../../src/firebase/firebase', () => ({ get firestore() { return connection.firestore }, firebaseAuth: { currentUser: { uid: 'member' } } }))

let env: RulesTestEnvironment
const past = Timestamp.fromMillis(1700000000000)
const db = () => env.authenticatedContext('member').firestore()
const header = () => ({ rfqId: 'rfq', supplierId: 'supplier', supplierName: '仕入先', requestId: null, quoteNumber: 'Q1', quoteDate: null, validUntil: null, documentId: null, subtotal: 100, tax: 10, total: 110, status: 'draft', note: '', revision: 1, archivedAt: null, archivedBy: null, createdAt: past, createdBy: 'member', updatedAt: past, updatedBy: 'member' })
const input = () => ({ rfqId: 'rfq', rfqItemId: 'a', productId: null, partNumber: 'A1', itemName: '商品', unit: '個', quantity: 2, unitPrice: 1000, shippingFee: 500, taxCategory: 'exclusive' as const, taxRateBps: 1000, shippingTaxCategory: 'exclusive' as const, shippingTaxRateBps: 1000, deliveryDate: null, note: '' })
beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Local emulator required')
  const [hostname, port] = host.split(':')
  env = await initializeTestEnvironment({ projectId: 'demo-ieppurchase-rules', firestore: { host: hostname, port: Number(port), rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } })
})
beforeEach(async () => {
  await env.clearFirestore()
  connection.firestore = db()
  await env.withSecurityRulesDisabled(async context => {
    const batch = writeBatch(context.firestore())
    for (const [path, data] of Object.entries({ 'rfqs/rfq': { subject: '案件' }, 'suppliers/supplier': { name: '仕入先', active: true }, 'supplierQuotes/quote': header(), 'rfqs/rfq/items/a': { productId: '', archivedAt: null, status: 'pending' }, 'rfqs/rfq/items/b': { productId: '', archivedAt: null, status: 'pending' }, 'rfqs/other/items/foreign': { productId: '', archivedAt: null, status: 'pending' } })) batch.set(doc(context.firestore(), path), data)
    await batch.commit()
  })
})
afterAll(async () => env?.cleanup())

async function save(id = 'one', values: DocumentData = {}, headerChanges: DocumentData = {}, options: { noHistory?: boolean; noHeader?: boolean; extraItem?: boolean } = {}) {
  const database = db(), parent = doc(database, 'supplierQuotes/quote'), item = doc(parent, 'items', id)
  const oldHeader = (await getDoc(parent)).data()!, oldItem = (await getDoc(item)).data()
  // Malformed values can be injected after calculation to exercise Rules independently of Zod.
  const nextItem = { ...input(), ...calculateLine(input()), ...oldItem, ...values, revision: (oldItem?.revision ?? 0) + 1, createdAt: oldItem?.createdAt ?? serverTimestamp(), createdBy: 'member', updatedAt: serverTimestamp(), updatedBy: 'member' }
  const managed = oldHeader.itemCount !== undefined
  const nextHeader = { ...oldHeader, subtotal: (managed ? oldHeader.subtotal : 0) - (oldItem?.subtotal ?? 0) + nextItem.subtotal, tax: (managed ? oldHeader.tax : 0) - (oldItem?.tax ?? 0) + nextItem.tax, total: (managed ? oldHeader.total : 0) - (oldItem?.total ?? 0) + nextItem.total, shippingTotal: (oldHeader.shippingTotal ?? 0) - (oldItem?.shippingTotal ?? 0) + nextItem.shippingTotal, itemCount: (oldHeader.itemCount ?? 0) + (oldItem ? 0 : 1), lastItemId: id, revision: oldHeader.revision + 1, updatedAt: serverTimestamp(), updatedBy: 'member', ...headerChanges }
  const batch = writeBatch(database)
  batch.set(item, nextItem)
  if (!options.noHeader) batch.set(parent, nextHeader)
  if (!options.noHistory) {
    batch.set(doc(item, 'revisions', String(nextItem.revision)), { snapshot: nextItem, createdAt: serverTimestamp(), createdBy: 'member' })
    batch.set(doc(parent, 'revisions', String(nextHeader.revision)), { revision: nextHeader.revision, snapshot: nextHeader, previousSnapshot: oldHeader, createdAt: serverTimestamp(), createdBy: 'member' })
  }
  if (options.extraItem) batch.set(doc(parent, 'items', 'unaccounted'), nextItem)
  return batch.commit()
}

describe('supplier quote item atomic integrity', () => {
  it('runs the production repository including competing writes and header edits', async () => {
    const value = { ...input(), deliveryDate: '2026-09-30' }
    const result = await Promise.allSettled([
      saveSupplierQuoteItem('rfq', 'quote', null, 1, value),
      saveSupplierQuoteItem('rfq', 'quote', null, 1, value),
    ])
    expect(result.filter(entry => entry.status === 'fulfilled')).toHaveLength(1)
    expect(result.filter(entry => entry.status === 'rejected')).toHaveLength(1)
    const records = await getDocs(collection(db(), 'supplierQuotes/quote/items'))
    expect(records.size).toBe(1)
    expect(records.docs[0].data().deliveryDate.toDate().toISOString()).toBe('2026-09-29T15:00:00.000Z')
    await assertSucceeds(saveSupplierQuoteItem('rfq', 'quote', records.docs[0].id, 2, { ...value, quantity: 3 }))
    const updated = (await getDoc(doc(db(), 'supplierQuotes/quote'))).data()!
    const headerInput = { supplierId: 'supplier', supplierName: '仕入先', requestId: '', quoteNumber: 'Q2', quoteDate: '', validUntil: '', documentId: '', subtotal: updated.subtotal, tax: updated.tax, total: updated.total, status: 'valid' as const, note: '' }
    await assertSucceeds(updateSupplierQuote('rfq', 'quote', headerInput, 3))
    await expect(updateSupplierQuote('rfq', 'quote', headerInput, 3)).rejects.toThrow('別の操作')
    await expect(updateSupplierQuote('rfq', 'quote', { ...headerInput, subtotal: 0, tax: 0, total: 0 }, 4)).rejects.toThrow('直接変更')
  })
  it('converts a legacy header, saves multiple items, edits and retains previous prices', async () => {
    await assertSucceeds(save())
    await assertSucceeds(save('two', { rfqItemId: 'b' }))
    const change = { ...input(), quantity: 3 }
    await assertSucceeds(save('one', { ...change, ...calculateLine(change) }))
    expect((await getDoc(doc(db(), 'supplierQuotes/quote'))).data()).toMatchObject({ itemCount: 2, subtotal: 6000, tax: 600, total: 6600, shippingTotal: 1100 })
    expect((await getDoc(doc(db(), 'supplierQuotes/quote/revisions/2'))).data()?.previousSnapshot.total).toBe(110)
    expect((await getDoc(doc(db(), 'supplierQuotes/quote/items/one/revisions/1'))).data()?.snapshot.total).toBe(2750)
    await assertSucceeds(getDocs(collection(db(), 'supplierQuotes/quote/items')))
  })
  it.each([
    { quantity: 0 }, { unitPrice: -1 }, { shippingFee: -1 }, { quantity: 1.0001 },
    { total: 999 }, { subtotal: 2499, total: 2749 }, { taxRateBps: 500 }, { productId: 'wrong' },
    { rfqItemId: 'foreign' }, { rfqId: 'other', rfqItemId: 'foreign' }, { taxCategory: 'unknown' },
  ])('rejects malformed money or cross-RFQ references: %j', async changes => assertFails(save('one', changes)))
  it('rejects missing histories, standalone items and unaccounted extra items', async () => {
    await assertFails(save('one', {}, {}, { noHistory: true }))
    await assertFails(save('one', {}, {}, { noHeader: true }))
    await assertFails(save('one', {}, {}, { extraItem: true }))
    await assertFails(save('one', {}, { total: 110, subtotal: 100, tax: 10 }))
  })
  it('rejects later total tampering, detached edits, changing references and mutable histories', async () => {
    await assertSucceeds(save())
    await assertFails(updateDoc(doc(db(), 'supplierQuotes/quote'), { subtotal: 0, tax: 0, total: 0, revision: 3, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db(), 'supplierQuotes/quote/items/one'), { note: 'detached', revision: 2, updatedAt: serverTimestamp() }))
    await assertFails(save('one', { rfqItemId: 'b' }))
    await assertFails(save('two', {}, { supplierId: 'changed' }))
    await assertFails(updateDoc(doc(db(), 'supplierQuotes/quote/items/one/revisions/1'), { createdBy: 'other' }))
    await assertFails(deleteDoc(doc(db(), 'supplierQuotes/quote/items/one')))
    await assertFails(deleteDoc(doc(db(), 'supplierQuotes/quote/revisions/2')))
  })
  it('supports a zero-delta item edit and a header-only metadata edit', async () => {
    await assertSucceeds(save())
    await assertSucceeds(save('one', { note: '備考のみ' }))
    const database = db(), parent = doc(database, 'supplierQuotes/quote'), old = (await getDoc(parent)).data()!
    const next = { ...old, quoteNumber: 'Q2', revision: old.revision + 1, updatedAt: serverTimestamp() }
    const batch = writeBatch(database)
    batch.set(parent, next)
    batch.set(doc(parent, 'revisions', String(next.revision)), { revision: next.revision, snapshot: next, previousSnapshot: old, createdAt: serverTimestamp(), createdBy: 'member' })
    await assertSucceeds(batch.commit())
  })
  it('handles mixed tax and decimal quantities precisely', async () => {
    const change = { ...input(), quantity: 1.001, taxCategory: 'inclusive' as const, shippingTaxCategory: 'exempt' as const, shippingTaxRateBps: 0 }
    await assertSucceeds(save('one', { ...change, ...calculateLine(change) }))
  })
  it('rejects inactive RFQ items and withdrawn quotes', async () => {
    await env.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'rfqs/rfq/items/a'), { archivedAt: past }))
    await assertFails(save())
    await env.withSecurityRulesDisabled(async context => { await updateDoc(doc(context.firestore(), 'rfqs/rfq/items/a'), { archivedAt: null }); await updateDoc(doc(context.firestore(), 'supplierQuotes/quote'), { status: 'withdrawn' }) })
    await assertFails(save())
  })
  it('rejects anonymous access', async () => {
    const database = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(database, 'supplierQuotes/quote/items/one')))
    await assertFails(setDoc(doc(database, 'supplierQuotes/quote/items/one'), input()))
  })
  it('enforces linked request scope and cancellation through Rules and the repository', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'supplierQuoteRequests/request'), { rfqId: 'rfq', supplierId: 'supplier', rfqItemIds: ['a'], status: 'requested' })
      await updateDoc(doc(context.firestore(), 'supplierQuotes/quote'), { requestId: 'request' })
    })
    await assertFails(save('wrong', { rfqItemId: 'b' }))
    await assertSucceeds(saveSupplierQuoteItem('rfq', 'quote', null, 1, { ...input(), deliveryDate: '' }))
    await env.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'supplierQuoteRequests/request'), { status: 'cancelled' }))
    await assertFails(save('cancelled'))
    await expect(saveSupplierQuoteItem('rfq', 'quote', null, 2, { ...input(), deliveryDate: '' })).rejects.toThrow('見積依頼')
  })
})
