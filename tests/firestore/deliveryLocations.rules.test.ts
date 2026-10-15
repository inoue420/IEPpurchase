import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let env: RulesTestEnvironment
const locationId = createHash('sha256').update('東京倉庫').digest('hex')
const past = Timestamp.fromMillis(1700000000000)
const master = () => ({ name: '東京倉庫', normalizedName: '東京倉庫', active: true, archivedAt: null,
  createdAt: serverTimestamp(), createdBy: 'user', updatedAt: serverTimestamp(), updatedBy: 'user' })
const rfq = () => ({ rfqNumber: 'RFQ-2026-000001', customerId: 'customer', customerName: 'Customer', subject: 'Test', receivedAt: past,
  dueDate: null, requestedDeliveryDate: null, status: 'received', assignedUserId: '', note: '',
  createdAt: serverTimestamp(), createdBy: 'user', updatedAt: serverTimestamp(), updatedBy: 'user' })
beforeAll(async () => {
  const value = process.env.FIRESTORE_EMULATOR_HOST
  if (!value || !/^(localhost|127\.0\.0\.1):\d+$/.test(value)) throw new Error('Local emulator required; no production access.')
  const [host, port] = value.split(':')
  env = await initializeTestEnvironment({ projectId: 'demo-ieppurchase-delivery-test', firestore: { host, port: Number(port), rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } })
})
beforeEach(async () => { await env.clearFirestore() })
afterAll(async () => { await env?.cleanup() })

describe('delivery location master and RFQ rules', () => {
  it('commits a new master and its RFQ selection atomically', async () => {
    const db = env.authenticatedContext('user').firestore(), batch = writeBatch(db)
    batch.set(doc(db, 'deliveryLocations', locationId), master())
    batch.set(doc(db, 'rfqs/rfq'), { ...rfq(), deliveryLocationId: locationId, deliveryLocationName: '東京倉庫' })
    await assertSucceeds(batch.commit())
    expect((await getDoc(doc(db, 'rfqs/rfq'))).get('deliveryLocationName')).toBe('東京倉庫')
    await assertSucceeds(getDocs(collection(db, 'deliveryLocations')))
  })
  it('rejects missing masters, mismatched names and inactive new selections', async () => {
    const db = env.authenticatedContext('user').firestore()
    await assertFails(setDoc(doc(db, 'rfqs/missing'), { ...rfq(), deliveryLocationId: locationId, deliveryLocationName: '東京倉庫' }))
    await setDoc(doc(db, 'deliveryLocations', locationId), master())
    await assertFails(setDoc(doc(db, 'rfqs/wrong'), { ...rfq(), deliveryLocationId: locationId, deliveryLocationName: '大阪倉庫' }))
    await updateDoc(doc(db, 'deliveryLocations', locationId), { active: false, archivedAt: serverTimestamp(), updatedAt: serverTimestamp() })
    await assertFails(setDoc(doc(db, 'rfqs/inactive'), { ...rfq(), deliveryLocationId: locationId, deliveryLocationName: '東京倉庫' }))
  })
  it('keeps historic RFQ selections editable after deactivation and permits explicit clearing', async () => {
    const db = env.authenticatedContext('user').firestore()
    await setDoc(doc(db, 'deliveryLocations', locationId), master())
    await setDoc(doc(db, 'rfqs/rfq'), { ...rfq(), deliveryLocationId: locationId, deliveryLocationName: '東京倉庫' })
    await updateDoc(doc(db, 'deliveryLocations', locationId), { active: false, archivedAt: serverTimestamp(), updatedAt: serverTimestamp() })
    await assertSucceeds(updateDoc(doc(db, 'rfqs/rfq'), { note: 'updated', updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(db, 'rfqs/rfq'), { deliveryLocationId: '', deliveryLocationName: '', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'rfqs/rfq'), { deliveryLocationId: locationId, deliveryLocationName: '東京倉庫', updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(db, 'deliveryLocations', locationId), { active: true, archivedAt: null, updatedAt: serverTimestamp() }))
  })
  it('preserves existing RFQs without delivery fields', async () => {
    const db = env.authenticatedContext('user').firestore()
    await assertSucceeds(setDoc(doc(db, 'rfqs/legacy'), rfq()))
    await assertSucceeds(updateDoc(doc(db, 'rfqs/legacy'), { subject: 'Updated', updatedAt: serverTimestamp() }))
  })
  it('denies anonymous access, physical deletion, renaming and creation metadata changes', async () => {
    const db = env.authenticatedContext('user').firestore(), anonymous = env.unauthenticatedContext().firestore()
    await setDoc(doc(db, 'deliveryLocations', locationId), master())
    await assertFails(getDoc(doc(anonymous, 'deliveryLocations', locationId)))
    await assertFails(setDoc(doc(anonymous, 'deliveryLocations', 'b'.repeat(64)), master()))
    for (const change of [{ name: 'Other' }, { normalizedName: 'other' }, { createdBy: 'other' }, { createdAt: Timestamp.now() }]) {
      await assertFails(updateDoc(doc(db, 'deliveryLocations', locationId), { ...change, updatedAt: serverTimestamp() }))
    }
    await assertFails(deleteDoc(doc(db, 'deliveryLocations', locationId)))
    await assertFails(setDoc(doc(db, 'deliveryLocations/invalid'), master()))
    await assertFails(setDoc(doc(db, 'deliveryLocations', 'b'.repeat(64)), { ...master(), name: 'x'.repeat(256) }))
  })
  it('concurrent first-use transactions reuse one master', async () => {
    const db = env.authenticatedContext('user').firestore()
    const useMaster = (id: string) => runTransaction(db, async transaction => {
      const ref = doc(db, 'deliveryLocations', locationId), existing = await transaction.get(ref)
      if (!existing.exists()) transaction.set(ref, master())
      transaction.set(doc(db, 'rfqs', id), { ...rfq(), deliveryLocationId: locationId, deliveryLocationName: '東京倉庫' })
    })
    await Promise.all([useMaster('a'), useMaster('b')])
    expect((await getDocs(collection(db, 'deliveryLocations'))).size).toBe(1)
  })
})
