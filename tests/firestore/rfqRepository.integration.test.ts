import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteField, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RfqInput } from '../../src/features/rfqs/rfqRepository'
import { localDateInput } from '../../src/features/rfqs/rfqItemSchema'

let env: RulesTestEnvironment
let db: ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>
let rfqs: typeof import('../../src/features/rfqs/rfqRepository')
let locations: typeof import('../../src/features/deliveryLocations/deliveryLocationRepository')
const auth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'user' } }
const input: RfqInput = { customerId: 'customer', subject: 'Existing workflow', receivedAt: '2026-10-15', dueDate: '', requestedDeliveryDate: '', status: 'received', assignedUserId: '', note: '' }

beforeAll(async () => {
  const value = process.env.FIRESTORE_EMULATOR_HOST
  if (!value || !/^(localhost|127\.0\.0\.1):\d+$/.test(value)) throw new Error('Local emulator required; no production access.')
  const [host, port] = value.split(':')
  env = await initializeTestEnvironment({ projectId: 'demo-ieppurchase-rfq-repository', firestore: { host, port: Number(port), rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } })
  db = env.authenticatedContext('user').firestore()
  // Only replace the app connection. All repository code, transactions and rules are real.
  vi.doMock('../../src/firebase/firebase', () => ({ firestore: db, firebaseAuth: auth }))
  rfqs = await import('../../src/features/rfqs/rfqRepository')
  locations = await import('../../src/features/deliveryLocations/deliveryLocationRepository')
})
beforeEach(async () => { auth.currentUser = { uid: 'user' }; await env.clearFirestore() })
afterAll(async () => { vi.doUnmock('../../src/firebase/firebase'); await env?.cleanup() })

describe('existing RFQ repository workflows with delivery locations', () => {
  it('allocates unique consecutive RFQ numbers without requiring a delivery location', async () => {
    const ids = await Promise.all([rfqs.createRfq(input, 'Customer'), rfqs.createRfq(input, 'Customer')])
    const saved = await Promise.all(ids.map(id => rfqs.getRfq(id)))
    expect(saved.map(rfq => rfq?.rfqNumber).sort()).toEqual(['RFQ-2026-000001', 'RFQ-2026-000002'])
    expect(saved.every(rfq => rfq?.deliveryLocationName === '' && rfq?.deliveryLocationId === '')).toBe(true)
    expect((await getDocs(collection(db, 'deliveryLocations'))).size).toBe(0)
  })
  it('reads and edits legacy RFQs without location fields, preserving numbering and creation data', async () => {
    const id = await rfqs.createRfq(input, 'Customer'), ref = doc(db, 'rfqs', id)
    await updateDoc(ref, { deliveryLocationId: deleteField(), deliveryLocationName: deleteField(), updatedAt: serverTimestamp() })
    const before = await rfqs.getRfq(id)
    await rfqs.updateRfq(id, { ...input, subject: 'Edited', status: 'quoting', dueDate: '2026-10-20', requestedDeliveryDate: '2026-10-22', note: 'Updated' }, 'Customer')
    const after = await rfqs.getRfq(id)
    expect(after).toMatchObject({ rfqNumber: before?.rfqNumber, createdBy: 'user', subject: 'Edited', status: 'quoting', note: 'Updated', deliveryLocationName: '' })
    expect(after?.createdAt?.toMillis()).toBe(before?.createdAt?.toMillis())
    expect(after?.dueDate).not.toBeNull()
    expect(after?.requestedDeliveryDate).not.toBeNull()
  })
  it('preserves a deactivated saved selection when old callers edit unrelated fields', async () => {
    const id = await rfqs.createRfq({ ...input, deliveryLocationName: 'Tokyo Warehouse' }, 'Customer')
    const before = await rfqs.getRfq(id)
    await locations.setDeliveryLocationActive(before!.deliveryLocationId!, false)
    await rfqs.updateRfq(id, { ...input, note: 'Keep historical location' }, 'Customer')
    expect(await rfqs.getRfq(id)).toMatchObject({ deliveryLocationId: before?.deliveryLocationId, deliveryLocationName: 'Tokyo Warehouse', note: 'Keep historical location' })
    expect((await getDoc(doc(db, 'deliveryLocations', before!.deliveryLocationId!))).get('active')).toBe(false)
  })
  it('retains received, due and delivery dates through an unchanged form round trip', async () => {
    const dates = { receivedAt: '2026-10-15', dueDate: '2026-10-20', requestedDeliveryDate: '2026-10-22' }
    const id = await rfqs.createRfq({ ...input, ...dates }, 'Customer'), before = (await rfqs.getRfq(id))!
    const reloaded = { ...input, receivedAt: localDateInput(before.receivedAt!.toDate()), dueDate: localDateInput(before.dueDate!.toDate()), requestedDeliveryDate: localDateInput(before.requestedDeliveryDate!.toDate()) }
    expect(reloaded).toMatchObject(dates)
    await rfqs.updateRfq(id, reloaded, 'Customer')
    const after = (await rfqs.getRfq(id))!
    for (const key of ['receivedAt', 'dueDate', 'requestedDeliveryDate'] as const) expect(after[key]?.toMillis()).toBe(before[key]?.toMillis())
  })
  it('reuses the canonical master name while saving a new RFQ with equivalent typed text', async () => {
    await rfqs.createRfq({ ...input, deliveryLocationName: 'Tokyo Warehouse' }, 'Customer')
    const id = await rfqs.createRfq({ ...input, deliveryLocationName: 'ＴＯＫＹＯ　ＷＡＲＥＨＯＵＳＥ' }, 'Customer')
    expect((await rfqs.getRfq(id))?.deliveryLocationName).toBe('Tokyo Warehouse')
    expect((await getDocs(collection(db, 'deliveryLocations'))).size).toBe(1)
  })
  it('guards stale location changes and supports deliberate clearing without losing other RFQ data', async () => {
    const id = await rfqs.createRfq(input, 'Customer'), empty = { deliveryLocationId: '', deliveryLocationName: '' }
    await rfqs.updateRfqDeliveryLocation(id, 'Tokyo Warehouse', empty)
    await expect(rfqs.updateRfqDeliveryLocation(id, 'Other Warehouse', empty)).rejects.toThrow('変更')
    expect((await getDocs(collection(db, 'deliveryLocations'))).size).toBe(1)
    await rfqs.updateRfq(id, { ...input, deliveryLocationName: '', note: 'Cleared intentionally' }, 'Customer')
    expect(await rfqs.getRfq(id)).toMatchObject({ deliveryLocationId: '', deliveryLocationName: '', note: 'Cleared intentionally', rfqNumber: 'RFQ-2026-000001' })
  })
  it('rolls back rejected selections without consuming a number and blocks anonymous saves', async () => {
    const id = await rfqs.createRfq({ ...input, deliveryLocationName: 'Tokyo Warehouse' }, 'Customer')
    const saved = await rfqs.getRfq(id)
    await locations.setDeliveryLocationActive(saved!.deliveryLocationId!, false)
    await expect(rfqs.createRfq({ ...input, deliveryLocationName: 'Tokyo Warehouse' }, 'Customer')).rejects.toThrow('無効')
    expect((await getDoc(doc(db, 'rfqCounters', '2026'))).get('nextSequence')).toBe(1)
    expect((await getDocs(collection(db, 'rfqs'))).size).toBe(1)
    auth.currentUser = null
    await expect(rfqs.createRfq(input, 'Customer')).rejects.toThrow('認証')
    await expect(rfqs.updateRfq(id, input, 'Customer')).rejects.toThrow('認証')
  })
})
