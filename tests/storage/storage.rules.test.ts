import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let env: RulesTestEnvironment
const parseHost = (value: string | undefined, name: string) => {
  if (!value || !/^(127\.0\.0\.1|localhost):\d+$/.test(value)) throw new Error(`Run with a local ${name} emulator.`)
  const [host, port] = value.split(':')
  return { host, port: Number(port) }
}

beforeAll(async () => {
  const firestore = parseHost(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore')
  const storage = parseHost(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Storage')
  env = await initializeTestEnvironment({
    projectId: 'demo-ieppurchase-storage-rules',
    firestore: { ...firestore, rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
    storage: { ...storage, rules: readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8') },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.clearStorage()
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'rfqs/existing'), { rfqNumber: 'RFQ-2026-000001' })
  })
})

afterAll(async () => { await env?.cleanup() })

describe('RFQ attachment storage rules', () => {
  it('allows a signed-in user to create and read an allowed immutable attachment', async () => {
    const storage = env.authenticatedContext('member').storage()
    const file = ref(storage, 'rfqs/existing/document-1')
    await assertSucceeds(uploadBytes(file, new Uint8Array([1]), { contentType: 'application/pdf' }))
    await assertSucceeds(getBytes(file))
    await assertFails(uploadBytes(file, new Uint8Array([2]), { contentType: 'application/pdf' }))
    await assertFails(deleteObject(file))
  })

  it('rejects anonymous, orphan, unsupported, empty and oversized uploads', async () => {
    const member = env.authenticatedContext('member').storage()
    const anonymous = env.unauthenticatedContext().storage()
    await assertFails(uploadBytes(ref(anonymous, 'rfqs/existing/anonymous'), new Uint8Array([1]), { contentType: 'application/pdf' }))
    await assertFails(uploadBytes(ref(member, 'rfqs/missing/orphan'), new Uint8Array([1]), { contentType: 'application/pdf' }))
    await assertFails(uploadBytes(ref(member, 'rfqs/existing/text'), new Uint8Array([1]), { contentType: 'text/plain' }))
    await assertFails(uploadBytes(ref(member, 'rfqs/existing/empty'), new Uint8Array(), { contentType: 'application/pdf' }))
    await assertFails(uploadBytes(ref(member, 'rfqs/existing/large'), new Uint8Array(10 * 1024 * 1024 + 1), { contentType: 'image/png' }))
  })
})
