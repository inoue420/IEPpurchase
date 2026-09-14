import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore'
import type { QuoteSettings, QuotePreview, FreeeQuotePayload } from '../../functions/src/salesQuoteModel'

const functionRequire = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = functionRequire('firebase-admin/app') as typeof import('../../functions/node_modules/firebase-admin/lib/app')
const { getFirestore, Timestamp } = functionRequire('firebase-admin/firestore') as typeof import('../../functions/node_modules/firebase-admin/lib/firestore')
const { SecretManagerServiceClient } = functionRequire('@google-cloud/secret-manager') as typeof import('../../functions/node_modules/@google-cloud/secret-manager')
interface Saved { revision: number; digest: string; preview: QuotePreview; payload: FreeeQuotePayload; status: string; marker: string }
type Callable = { run: (request: { auth?: { uid: string }; data: Record<string, unknown> }) => Promise<Saved & { result?: { id: number }; status: string }> }
const { saveSalesQuotePricing, sendFreeeQuotation, reconcileFreeeQuotation } = functionRequire('./lib/freeeQuotation.js') as Record<string, Callable>
const projectId = 'demo-ieppurchase-freee-test'
let env: RulesTestEnvironment
let app: ReturnType<typeof initializeApp>
let db: ReturnType<typeof getFirestore>
const source = { rfqId: 'rfq', rfqItemId: 'item', lineNo: 1, partNumber: 'A-1', quantity: 2, unit: 'pcs', originalDescription: 'ボルト', translatedDescription: 'Bolt', outputDescription: 'Bolt' }
const settings: QuoteSettings = { partnerId: '123', quotationDate: '2026-09-14', expirationDate: '', subject: 'Test', quotationNumber: '', partnerTitle: '御中', taxEntryMethod: 'out', taxFraction: 'omit', lineAmountFraction: 'omit', note: '', translationsReviewed: false, prices: [{ rfqItemId: 'item', unitPrice: '100', taxRate: 10, reducedTaxRate: false }] }
const run = (call: Callable, data: Record<string, unknown>, uid = 'user') => call.run({ auth: { uid }, data: { rfqId: 'rfq', ...data } })
const save = (expectedRevision = 0) => run(saveSalesQuotePricing, { settings, expectedRevision })
const send = (saved: Saved) => run(sendFreeeQuotation, { revision: saved.revision, digest: saved.digest, confirm: true })
const ref = () => db.doc('salesQuotes/rfq/freeeExports/current')
const successfulResponse = (saved: Saved) => ({ quotation: { id: 99, company_id: 456, partner_id: 123, memo: saved.marker, quotation_number: 'Q-99', lines: saved.payload.lines, total_amount: 220, amount_tax: 20, report_url: 'https://invoice.freee.co.jp/reports/99' } })

beforeAll(async () => {
  const hostValue = process.env.FIRESTORE_EMULATOR_HOST
  if (!hostValue || !/^(127\.0\.0\.1|localhost):\d+$/.test(hostValue)) throw new Error('Local emulator is required. No production access is allowed.')
  const [host, port] = hostValue.split(':')
  app = initializeApp({ projectId }); db = getFirestore(app)
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } })
})
beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  // All Secret Manager and freee HTTP calls are replaced. Only the local DB is real.
  vi.spyOn(SecretManagerServiceClient.prototype, 'accessSecretVersion').mockImplementation((() => Promise.resolve([{ payload: { data: Buffer.from(JSON.stringify({ companyId: '456', accessToken: 'FAKE', authorizedAt: new Date().toISOString(), expiresIn: 21600 })) } }])) as never)
  await env.clearFirestore()
  await db.doc('rfqs/rfq').set({ status: 'quoting', customerId: 'customer', customerName: 'Customer' })
  await db.doc('salesQuotes/rfq').set({ rfqId: 'rfq', status: 'confirmed', confirmedAt: Timestamp.now() })
  await db.doc('salesQuotes/rfq/items/item').set({ ...source, confirmedAt: Timestamp.now() })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected HTTP request') }))
})
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await env?.cleanup(); if (app) await deleteApp(app) })

describe('freee quotation transaction and authorization integration', () => {
  it('requires authentication and explicit send confirmation before credentials or HTTP', async () => {
    for (const call of [saveSalesQuotePricing, sendFreeeQuotation, reconcileFreeeQuotation]) await expect(call.run({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(run(sendFreeeQuotation, { revision: 1, digest: 'x' })).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('saves original confirmed snapshots, recalculates prices and preserves old revisions', async () => {
    const first = await save()
    await db.doc('rfqs/rfq/items/item').set({ originalDescription: 'Changed', quantity: 9 })
    const second = await run(saveSalesQuotePricing, { expectedRevision: 1, settings: { ...settings, prices: [{ ...settings.prices[0], unitPrice: '200' }] } })
    expect(first.preview.total).toBe(220); expect(second.preview.total).toBe(440)
    expect(second.preview.lines[0]).toMatchObject({ originalDescription: 'ボルト', quantity: 2 })
    expect((await ref().collection('revisions').doc('1').get()).get('preview.total')).toBe(220)
    await expect(save(1)).rejects.toMatchObject({ code: 'aborted' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects unconfirmed lines and client-provided altered quantities or extra lines', async () => {
    await db.doc('salesQuotes/rfq/items/item').update({ confirmedAt: null })
    await expect(save()).rejects.toMatchObject({ code: 'failed-precondition' })
    await db.doc('salesQuotes/rfq/items/item').update({ confirmedAt: Timestamp.now() })
    await expect(run(saveSalesQuotePricing, { expectedRevision: 0, settings: { ...settings, prices: [{ ...settings.prices[0], rfqItemId: 'other' }] } })).rejects.toMatchObject({ code: 'failed-precondition' })
  })
  it('permits only one POST when two users send the same revision concurrently', async () => {
    const saved = await save()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(successfulResponse(saved)))))
    const results = await Promise.allSettled([send(saved), send(saved)])
    expect(results.some(r => r.status === 'fulfilled')).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((await ref().get()).get('status')).toBe('sent')
    await send(saved)
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(save(1)).rejects.toMatchObject({ code: 'failed-precondition' })
  })
  it('blocks stale previews, changed customers and changed connection companies', async () => {
    const first = await save(); await save(1)
    await expect(send(first)).rejects.toMatchObject({ code: 'aborted' })
    const saved = (await ref().get()).data() as Saved
    await db.doc('rfqs/rfq').update({ customerId: 'different' })
    await expect(send(saved)).rejects.toMatchObject({ code: 'failed-precondition' })
    await db.doc('rfqs/rfq').update({ customerId: 'customer' })
    await ref().update({ companyId: 789 })
    await expect(send(saved)).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('allows deliberate retry only after a definite rejection', async () => {
    const saved = await save()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 400 })))
    expect((await send(saved)).status).toBe('failed')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(successfulResponse(saved)))))
    expect((await send(saved)).status).toBe('sent')
    expect((await ref().get()).get('attempt')).toBe(2)
  })
  it('keeps ambiguous outcomes locked and reconciles by company, partner, ID and unique memo using GET only', async () => {
    const saved = await save()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    expect((await send(saved)).status).toBe('uncertain')
    await expect(send(saved)).rejects.toMatchObject({ code: 'failed-precondition' })
    await expect(save(1)).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(fetch).toHaveBeenCalledTimes(1)
    await ref().update({ startedAt: Timestamp.fromMillis(Date.now() - 121_000) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ quotation: { ...successfulResponse(saved).quotation, memo: 'other' } }))))
    await expect(run(reconcileFreeeQuotation, { quotationId: 99 })).rejects.toMatchObject({ code: 'failed-precondition' })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.freee.co.jp/iv/quotations/99?company_id=456'); expect(init.method).toBeUndefined()
      return new Response(JSON.stringify(successfulResponse(saved)))
    }))
    expect((await run(reconcileFreeeQuotation, { quotationId: 99 })).status).toBe('sent')
  })
  it('leaves sent state and ID intact when freee returns a different total', async () => {
    const saved = await save()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ quotation: { ...successfulResponse(saved).quotation, total_amount: 999 } }))))
    await send(saved)
    expect((await ref().get()).get('result.verification')).toBe('needs_review')
    await send(saved); expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('allows authenticated history reads but denies all direct state, snapshot and result writes', async () => {
    await save()
    const client = env.authenticatedContext('user').firestore(), anonymous = env.unauthenticatedContext().firestore()
    for (const path of ['salesQuotes/rfq/freeeExports/current', 'salesQuotes/rfq/freeeExports/current/revisions/1']) {
      await assertSucceeds(getDoc(doc(client, path)))
      await assertFails(getDoc(doc(anonymous, path)))
      await assertFails(setDoc(doc(client, path), { status: 'draft' }))
      await assertFails(updateDoc(doc(client, path), { total: 0 }))
      await assertFails(deleteDoc(doc(client, path)))
    }
    await assertSucceeds(getDocs(collection(client, 'salesQuotes/rfq/freeeExports/current/events')))
    await assertFails(setDoc(doc(client, 'salesQuotes/rfq/freeeExports/current/events/fake'), { action: 'sent' }))
    await assertFails(setDoc(doc(client, 'salesQuotes/rfq/freeeExports/current/revisions/2'), { total: 0 }))
  })
})
