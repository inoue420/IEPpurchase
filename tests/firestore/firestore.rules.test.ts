import { readFileSync } from 'node:fs'
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  Timestamp, collection, deleteDoc, deleteField, doc, getDoc, getDocs,
  orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch,
  type DocumentData,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let env: RulesTestEnvironment
const past = Timestamp.fromMillis(1_700_000_000_000)
const dbFor = (uid: string) => env.authenticatedContext(uid).firestore()
const profile = (role = 'member', active = true) => ({
  email: 'staff@example.test', displayName: 'Staff', role, active,
  createdAt: past, updatedAt: past,
})
const contact = () => ({
  name: '取引先', contactName: '', email: '', phone: '', postalCode: '',
  address: '', notes: '', active: true, archivedAt: null,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
})
const product = () => ({
  manufacturerId: '', manufacturerName: 'メーカー', partNumber: 'A-1',
  normalizedPartNumber: 'A1', name: '商品', janCode: '', category: '', unit: '個',
  notes: '', active: true, archivedAt: null,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
})
const rfq = () => ({
  rfqNumber: 'RFQ-2026-000001', customerId: 'existing', customerName: '取引先',
  subject: '見積依頼', receivedAt: past, dueDate: null, requestedDeliveryDate: null,
  status: 'received', assignedUserId: '', note: '',
  createdAt: serverTimestamp(), createdBy: 'member',
  updatedAt: serverTimestamp(), updatedBy: 'member',
})
const item = () => ({
  lineNo: 1, originalDescription: '依頼品目', translatedDescription: '',
  productId: '', manufacturerId: '', manufacturerName: '', partNumber: '',
  productName: '', quantity: 1, unit: '個', requestedDeliveryDate: null,
  status: 'pending', note: '', archivedAt: null,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
})
const documents = [
  ['customers/existing', contact],
  ['suppliers/existing', contact],
  ['products/existing', product],
  ['rfqs/existing', rfq],
  ['rfqs/existing/items/existing', item],
  ['rfqCounters/2026', () => ({ year: '2026', nextSequence: 1, updatedAt: serverTimestamp() })],
  ['rfqs/existing/itemCounters/sequence', () => ({ lastLineNo: 1, updatedAt: serverTimestamp() })],
] as const

beforeAll(async () => {
  // Refuse to run unless a local emulator was explicitly supplied by emulators:exec.
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error('Run npm run test:rules with a local Firestore emulator.')
  }
  const [hostname, port] = host.split(':')
  env = await initializeTestEnvironment({
    projectId: 'demo-ieppurchase-rules',
    firestore: {
      host: hostname, port: Number(port),
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    const batch = writeBatch(db)
    for (const [uid, role, active] of [
      ['admin', 'admin', true], ['member', 'member', true],
      ['disabled', 'member', false], ['disabled-admin', 'admin', false],
      ['unknown-role', 'viewer', true],
    ] as const) {
      batch.set(doc(db, 'users', uid), profile(role, active))
    }
    for (const [path, factory] of documents) {
      batch.set(doc(db, path), { ...factory(), createdAt: past, updatedAt: past })
    }
    // Counters have no createdAt field.
    batch.set(doc(db, 'rfqCounters/2026'), { year: '2026', nextSequence: 1, updatedAt: past })
    batch.set(doc(db, 'rfqs/existing/itemCounters/sequence'), { lastLineNo: 1, updatedAt: past })
    await batch.commit()
  })
})

afterAll(async () => { await env?.cleanup() })

describe('company access boundary', () => {
  it.each(['unauthenticated', 'unregistered', 'disabled', 'disabled-admin', 'unknown-role'])(
    '%s cannot read or write any business collection', async identity => {
      const db = identity === 'unauthenticated' ? env.unauthenticatedContext().firestore() : dbFor(identity)
      for (const [path, factory] of documents) {
        await assertFails(getDoc(doc(db, path)))
        await assertFails(setDoc(doc(db, path), factory()))
        await assertFails(deleteDoc(doc(db, path)))
        const collectionPath = path.slice(0, path.lastIndexOf('/'))
        await assertFails(getDocs(collection(db, collectionPath)))
      }
    },
  )
  it.each(['admin', 'member'])('%s can read business records but cannot physically delete them', async uid => {
    const db = dbFor(uid)
    for (const [path] of documents) {
      await assertSucceeds(getDoc(doc(db, path)))
      await assertFails(deleteDoc(doc(db, path)))
    }
    for (const [path, field] of [
      ['customers', 'name'], ['suppliers', 'name'], ['products', 'manufacturerName'],
      ['rfqs', 'receivedAt'], ['rfqs/existing/items', 'lineNo'],
    ]) {
      await assertSucceeds(getDocs(query(collection(db, path), orderBy(field))))
    }
    await assertFails(getDocs(collection(db, 'rfqCounters')))
    await assertFails(getDocs(collection(db, 'rfqs/existing/itemCounters')))
  })
  it('rejects unknown paths, nested paths and future features even for admin', async () => {
    const db = dbFor('admin')
    for (const path of ['settings/system', 'auditLogs/log', 'salesQuotes/quote', 'customers/existing/private/data']) {
      await assertFails(getDoc(doc(db, path)))
      await assertFails(setDoc(doc(db, path), { value: true }))
    }
  })
  it('takes account deactivation into effect with the same authenticated context', async () => {
    const db = dbFor('member')
    await assertSucceeds(getDoc(doc(db, 'customers/existing')))
    await assertSucceeds(updateDoc(doc(dbFor('admin'), 'users/member'), {
      active: false, updatedAt: serverTimestamp(),
    }))
    await assertFails(getDoc(doc(db, 'customers/existing')))
    await assertFails(setDoc(doc(db, 'customers/new'), contact()))
  })
})

describe('user privileges', () => {
  it('allows own profile read but not reading/listing other users as member', async () => {
    const db = dbFor('member')
    await assertSucceeds(getDoc(doc(db, 'users/member')))
    await assertFails(getDoc(doc(db, 'users/admin')))
    await assertFails(getDocs(collection(db, 'users')))
    await assertSucceeds(getDocs(collection(dbFor('admin'), 'users')))
  })
  it.each(['member', 'unregistered', 'disabled-admin'])('%s cannot self-provision, elevate or manage users', async uid => {
    const db = dbFor(uid)
    await assertFails(setDoc(doc(db, 'users/new'), {
      ...profile('admin'), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }))
    await assertFails(setDoc(doc(db, 'users', uid), {
      ...profile('admin'), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }))
    await assertFails(updateDoc(doc(db, 'users/member'), { role: 'admin', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(doc(db, 'users/member')))
  })
  it('admin can provision and change another user, but cannot deactivate/demote self or delete users', async () => {
    const db = dbFor('admin')
    await assertSucceeds(setDoc(doc(db, 'users/new'), {
      ...profile(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }))
    await assertSucceeds(updateDoc(doc(db, 'users/new'), { role: 'admin', updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(db, 'users/new'), { active: false, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'users/admin'), { active: false, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'users/admin'), { role: 'member', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(doc(db, 'users/new')))
  })
  it.each([
    { role: 'owner' }, { active: 'true' }, { unexpected: true },
    { createdAt: serverTimestamp() }, { updatedAt: past }, { displayName: deleteField() },
  ])('rejects malformed user updates: %j', async change => {
    await assertFails(updateDoc(doc(dbFor('admin'), 'users/member'), { updatedAt: serverTimestamp(), ...change }))
  })
})

describe.each([['customers', contact], ['suppliers', contact], ['products', product]] as const)(
  '%s lifecycle', (path, factory) => {
    it('supports member create, edit, archive and restore with immutable creation time', async () => {
      const db = dbFor('member')
      const ref = doc(db, path, 'new')
      await assertSucceeds(setDoc(ref, factory()))
      const createdAt = (await getDoc(ref)).data()?.createdAt as Timestamp
      await assertSucceeds(updateDoc(ref, { notes: '編集', updatedAt: serverTimestamp() }))
      await assertSucceeds(updateDoc(ref, { active: false, archivedAt: serverTimestamp(), updatedAt: serverTimestamp() }))
      await assertSucceeds(updateDoc(ref, { notes: '無効中の編集', updatedAt: serverTimestamp() }))
      await assertSucceeds(updateDoc(ref, { active: true, archivedAt: null, updatedAt: serverTimestamp() }))
      expect((await getDoc(ref)).data()?.createdAt).toEqual(createdAt)
    })
    it.each([
      { name: '' }, { name: 123 }, { active: 'true' }, { notes: 'x'.repeat(5001) },
      { unexpected: true }, { createdAt: past }, { updatedAt: past },
      { active: false, archivedAt: past },
    ])('rejects malformed creation', async change => {
      await assertFails(setDoc(doc(dbFor('member'), path, 'new'), { ...factory(), ...change }))
    })
    it('rejects removed fields, creation timestamp changes and fake archive timestamps', async () => {
      const ref = doc(dbFor('member'), path, 'existing')
      for (const change of [
        { name: deleteField() }, { createdAt: serverTimestamp() },
        { active: false, archivedAt: past }, { active: true, archivedAt: past },
      ]) {
        await assertFails(updateDoc(ref, { updatedAt: serverTimestamp(), ...change }))
      }
    })
  },
)

describe('RFQ and counters', () => {
  function createRfq(number: string, sequence: number, changes: DocumentData = {}) {
    const db = dbFor('member')
    const batch = writeBatch(db)
    batch.set(doc(db, 'rfqCounters/2026'), { year: '2026', nextSequence: sequence, updatedAt: serverTimestamp() })
    batch.set(doc(db, 'rfqs/new'), { ...rfq(), rfqNumber: number, ...changes })
    return batch.commit()
  }
  it('supports transaction-based counter increments and RFQ edits', async () => {
    await assertSucceeds(createRfq('RFQ-2026-000002', 2))
    await assertSucceeds(updateDoc(doc(dbFor('member'), 'rfqs/new'), {
      subject: '変更', updatedBy: 'member', updatedAt: serverTimestamp(),
    }))
    await assertSucceeds(setDoc(doc(dbFor('member'), 'rfqCounters/2027'), {
      year: '2027', nextSequence: 1, updatedAt: serverTimestamp(),
    }))
  })
  it('rejects an impersonated creator or updater', async () => {
    await assertFails(createRfq('RFQ-2026-000002', 2, { createdBy: 'admin' }))
    await assertFails(createRfq('RFQ-2026-000002', 2, { updatedBy: 'admin' }))
  })
  it.each([0, 1, 3, 1.5, 1000000])('rejects counter rewind/jump/invalid number %s', async sequence => {
    await assertFails(setDoc(doc(dbFor('member'), 'rfqCounters/2026'), {
      year: '2026', nextSequence: sequence, updatedAt: serverTimestamp(),
    }))
  })
  it('rejects invalid counter IDs and an initial value other than one', async () => {
    for (const [year, sequence] of [['bad', 1], ['2027', 2]] as const) {
      await assertFails(setDoc(doc(dbFor('member'), 'rfqCounters', year), {
        year, nextSequence: sequence, updatedAt: serverTimestamp(),
      }))
    }
  })
  it.each([
    { rfqNumber: 'RFQ-2026-000099' }, { createdBy: 'admin' },
    { createdAt: serverTimestamp() }, { updatedBy: 'admin' },
    { status: 'invalid' }, { subject: '' }, { extra: true },
  ])('rejects immutable or malformed RFQ changes', async change => {
    await assertFails(updateDoc(doc(dbFor('member'), 'rfqs/existing'), {
      updatedAt: serverTimestamp(), updatedBy: 'member', ...change,
    }))
  })
})

describe('RFQ items', () => {
  function createItem(parent = 'existing', lineNo = 2) {
    const db = dbFor('member')
    const batch = writeBatch(db)
    batch.set(doc(db, 'rfqs', parent, 'itemCounters', 'sequence'), { lastLineNo: lineNo, updatedAt: serverTimestamp() })
    batch.set(doc(db, 'rfqs', parent, 'items', 'new'), { ...item(), lineNo })
    return batch.commit()
  }
  it('supports allocation, edits, archive and restore', async () => {
    await assertSucceeds(createItem())
    const ref = doc(dbFor('member'), 'rfqs/existing/items/new')
    await assertSucceeds(updateDoc(ref, { quantity: 2, updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(ref, { archivedAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { quantity: 3, updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(ref, { archivedAt: null, updatedAt: serverTimestamp() }))
  })
  it('rejects orphan items, counter jumps and standalone allocations', async () => {
    await assertFails(createItem('missing', 1))
    await assertFails(createItem('existing', 3))
    await assertFails(setDoc(doc(dbFor('member'), 'rfqs/existing/items/new'), item()))
  })
  it.each([
    { lineNo: 9 }, { quantity: 0 }, { quantity: -1 }, { quantity: Number.POSITIVE_INFINITY },
    { unit: '' }, { originalDescription: '' }, { status: 'invalid' }, { extra: true },
    { createdAt: serverTimestamp() }, { archivedAt: past },
  ])('rejects malformed or immutable item changes', async change => {
    await assertFails(updateDoc(doc(dbFor('member'), 'rfqs/existing/items/existing'), {
      updatedAt: serverTimestamp(), ...change,
    }))
  })
})
