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
  it.each(['unauthenticated'])(
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
  it.each(['admin', 'member', 'unregistered', 'disabled', 'disabled-admin', 'unknown-role'])('%s can read business records but cannot physically delete them', async uid => {
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
  it('does not use profile active status for application access', async () => {
    const db = dbFor('member')
    await assertSucceeds(getDoc(doc(db, 'customers/existing')))
    await assertSucceeds(updateDoc(doc(dbFor('admin'), 'users/member'), {
      active: false, updatedAt: serverTimestamp(),
    }))
    await assertSucceeds(getDoc(doc(db, 'customers/existing')))
    await assertSucceeds(setDoc(doc(db, 'customers/new'), contact()))
  })
})

describe('authenticated user access', () => {
  it.each(['member', 'unregistered', 'disabled-admin'])('%s may manage valid profile data without role-based permissions', async uid => {
    const db = dbFor(uid)
    await assertSucceeds(getDoc(doc(db, 'users/admin')))
    await assertSucceeds(getDocs(collection(db, 'users')))
    await assertSucceeds(setDoc(doc(db, 'users/new'), {
      ...profile(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }))
    await assertSucceeds(updateDoc(doc(db, 'users/new'), { active: false, updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(doc(db, 'users/new')))
  })
  it('allows a user without a profile to create and edit an RFQ', async () => {
    const db = dbFor('unregistered')
    const ref = doc(db, 'rfqs/new')
    await assertSucceeds(setDoc(ref, { ...rfq(), createdBy: 'unregistered', updatedBy: 'unregistered' }))
    await assertSucceeds(updateDoc(ref, { subject: '更新', updatedAt: serverTimestamp(), updatedBy: 'unregistered' }))
    await assertSucceeds(getDocs(query(collection(db, 'rfqs'), orderBy('receivedAt'))))
  })
  it('rejects anonymous profile reads and writes', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'users/member')))
    await assertFails(getDocs(collection(db, 'users')))
    await assertFails(setDoc(doc(db, 'users/new'), { ...profile(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  })
  it.each([
    { role: 'owner' }, { active: 'true' }, { unexpected: true },
    { createdAt: serverTimestamp() }, { updatedAt: past }, { displayName: deleteField() },
  ])('preserves profile data validation: %j', async change => {
    await assertFails(updateDoc(doc(dbFor('member'), 'users/admin'), { updatedAt: serverTimestamp(), ...change }))
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

describe('supplier quote requests', () => {
  const request = () => ({
    rfqId: 'existing', supplierId: 'existing', supplierName: '取引先', rfqItemIds: ['existing'],
    requestedAt: null, responseDueDate: null, status: 'draft', note: '',
    createdAt: serverTimestamp(), createdBy: 'member', updatedAt: serverTimestamp(), updatedBy: 'member',
  })
  it('allows valid records and rejects invalid relationships or unauthenticated access', async () => {
    const ref = doc(dbFor('member'), 'supplierQuoteRequests', 'new')
    await assertSucceeds(setDoc(ref, request()))
    await assertSucceeds(updateDoc(ref, { status: 'requested', requestedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'member' }))
    await assertFails(setDoc(doc(dbFor('member'), 'supplierQuoteRequests', 'bad-rfq'), { ...request(), rfqId: 'missing' }))
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'supplierQuoteRequests', 'anon'), request()))
  })
  it('rejects immutable RFQ and creator changes, invalid dates and physical deletion', async () => {
    const ref = doc(dbFor('member'), 'supplierQuoteRequests', 'new')
    await assertSucceeds(setDoc(ref, request()))
    await assertFails(updateDoc(ref, { rfqId: 'other', updatedAt: serverTimestamp(), updatedBy: 'member' }))
    await assertFails(updateDoc(ref, { createdBy: 'admin', updatedAt: serverTimestamp(), updatedBy: 'member' }))
    await assertFails(updateDoc(ref, { status: 'requested', requestedAt: null, updatedAt: serverTimestamp(), updatedBy: 'member' }))
    await assertFails(deleteDoc(ref))
  })
})
describe('supplier request access without a users profile', () => {
  it('allows another logged-in user to edit while preserving original creator', async () => {
    const ref = doc(dbFor('member'), 'supplierQuoteRequests/shared')
    await assertSucceeds(setDoc(ref, {
      rfqId: 'existing', supplierId: 'existing', supplierName: '取引先', rfqItemIds: ['existing'],
      requestedAt: null, responseDueDate: null, status: 'draft', note: '',
      createdAt: serverTimestamp(), createdBy: 'member', updatedAt: serverTimestamp(), updatedBy: 'member',
    }))
    const other = doc(dbFor('unregistered'), 'supplierQuoteRequests/shared')
    await assertSucceeds(getDoc(other))
    await assertSucceeds(updateDoc(other, { note: '他の利用者による更新', updatedAt: serverTimestamp(), updatedBy: 'unregistered' }))
    await assertFails(updateDoc(other, { createdBy: 'unregistered', updatedAt: serverTimestamp(), updatedBy: 'unregistered' }))
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'supplierQuoteRequests/shared')))
  })
})

describe('marketplace offer snapshots', () => {
  const offer = (changes: DocumentData = {}) => ({
    rfqId: 'existing', rfqItemId: 'existing', productId: null,
    source: 'amazon', externalItemId: 'ASIN-1', sellerName: '販売者',
    itemName: '商品', partNumber: 'A-1', quantity: 2, quantityMillis: 2000,
    unit: '個', unitPrice: 1100, shippingFee: 550,
    taxCategory: 'inclusive', taxRateBps: 1000,
    shippingTaxCategory: 'inclusive', shippingTaxRateBps: 1000,
    subtotal: 2500, tax: 250, total: 2750, shippingTotal: 550, totalPrice: 2750,
    stockStatus: '在庫あり', estimatedDeliveryDate: null,
    itemUrl: 'https://example.test/item', retrievedAt: past, note: '',
    createdAt: serverTimestamp(), createdBy: 'member', ...changes,
  })
  it('adds separate snapshots and preserves old prices', async () => {
    const db = dbFor('member')
    await assertSucceeds(setDoc(doc(db, 'marketplaceOffers/first'), offer()))
    await assertSucceeds(setDoc(doc(db, 'marketplaceOffers/second'), offer({ unitPrice: 1200, subtotal: 2682, tax: 268, total: 2950, totalPrice: 2950 })))
    expect((await getDocs(collection(db, 'marketplaceOffers'))).size).toBe(2)
    await assertFails(updateDoc(doc(db, 'marketplaceOffers/first'), { unitPrice: 1200 }))
    await assertFails(deleteDoc(doc(db, 'marketplaceOffers/first')))
  })
  it('distinguishes unknown shipping from free shipping', async () => {
    const db = dbFor('member')
    await assertSucceeds(setDoc(doc(db, 'marketplaceOffers/unknown-shipping'), offer({ shippingFee: null, subtotal: null, tax: null, total: null, shippingTotal: null, totalPrice: null })))
    await assertSucceeds(setDoc(doc(db, 'marketplaceOffers/free-shipping'), offer({ shippingFee: 0, subtotal: 2000, tax: 200, total: 2200, shippingTotal: 0, totalPrice: 2200 })))
  })
  it('rejects invalid references, totals, authors and anonymous writes', async () => {
    const db = dbFor('member')
    await assertFails(setDoc(doc(db, 'marketplaceOffers/missing-item'), offer({ rfqItemId: 'missing' })))
    await assertFails(setDoc(doc(db, 'marketplaceOffers/bad-total'), offer({ totalPrice: 9999 })))
    await assertFails(setDoc(doc(db, 'marketplaceOffers/bad-author'), offer({ createdBy: 'admin' })))
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'marketplaceOffers/anon'), offer()))
  })
})
