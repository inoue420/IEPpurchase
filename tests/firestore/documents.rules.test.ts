import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let env: RulesTestEnvironment
const dbFor = (uid: string) => env.authenticatedContext(uid).firestore()

beforeAll(async () => {
  const value = process.env.FIRESTORE_EMULATOR_HOST
  if (!value || !/^(127\.0\.0\.1|localhost):\d+$/.test(value)) throw new Error('Run npm run test:rules with a local Firestore emulator.')
  const [host, port] = value.split(':')
  env = await initializeTestEnvironment({
    projectId: 'demo-ieppurchase-documents-rules',
    firestore: { host, port: Number(port), rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'rfqs/existing'), { rfqNumber: 'RFQ-2026-000001' })
    await setDoc(doc(context.firestore(), 'supplierQuotes/quote-1'), { rfqId: 'existing' })
  })
})

afterAll(async () => { await env?.cleanup() })

const metadata = (changes: Record<string, unknown> = {}) => ({
  fileName: 'quote.pdf', storagePath: 'rfqs/existing/document-1', mimeType: 'application/pdf',
  fileSize: 1024, documentType: 'supplier_quote', entityType: 'supplierQuote',
  entityId: 'quote-1', rfqId: 'existing', uploadedBy: 'member', createdAt: serverTimestamp(),
  ...changes,
})

describe('document metadata rules', () => {
  it('allows valid metadata reads and creation but keeps it immutable', async () => {
    const ref = doc(dbFor('member'), 'documents/document-1')
    await assertSucceeds(setDoc(ref, metadata()))
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(getDocs(collection(dbFor('member'), 'documents')))
    await assertFails(updateDoc(ref, { fileName: 'changed.pdf' }))
    await assertFails(deleteDoc(ref))
  })

  it.each([
    { storagePath: 'rfqs/other/document-1' },
    { mimeType: 'text/plain' },
    { fileSize: 0 },
    { fileSize: 10 * 1024 * 1024 + 1 },
    { entityId: 'missing' },
    { rfqId: 'missing', storagePath: 'rfqs/missing/document-1' },
    { uploadedBy: 'admin' },
    { unexpected: true },
  ])('rejects invalid metadata %#', async changes => {
    await assertFails(setDoc(doc(dbFor('member'), 'documents/document-1'), metadata(changes)))
  })

  it('rejects anonymous reads and writes', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(db, 'documents/document-1'), metadata()))
    await assertFails(getDoc(doc(db, 'documents/document-1')))
    await assertFails(getDocs(collection(db, 'documents')))
  })
})
