import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore'
import type { QuoteSettings, QuotePreview, FreeeQuotePayload } from '../../functions/src/salesQuoteModel'
import type { OAuthTokenMetadataStore, OAuthTokenSecretManager } from '../../functions/src/oauthTokenStore'

const functionRequire = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = functionRequire('firebase-admin/app') as typeof import('../../functions/node_modules/firebase-admin/lib/app')
const { getFirestore, Timestamp } = functionRequire('firebase-admin/firestore') as typeof import('../../functions/node_modules/firebase-admin/lib/firestore')
const { SecretManagerServiceClient } = functionRequire('@google-cloud/secret-manager') as typeof import('../../functions/node_modules/@google-cloud/secret-manager')
interface Saved { revision: number; digest: string; preview: QuotePreview; payload: FreeeQuotePayload; status: string; marker: string; editing?: boolean; operation?: string }
type Callable = { run: (request: { auth?: { uid: string }; data: Record<string, unknown> }) => Promise<Saved & { result?: { id: number }; status: string }> }
const { saveSalesQuotePricing, sendFreeeQuotation, reconcileFreeeQuotation, startSalesQuoteRevision } = functionRequire('./lib/freeeQuotation.js') as Record<string, Callable>
const { freeeTokenMetadata, FREEE_TOKEN_METADATA_PATH } = functionRequire('./lib/freeeTokenMetadata.js') as {
  freeeTokenMetadata: (parent: string) => OAuthTokenMetadataStore
  FREEE_TOKEN_METADATA_PATH: string
}
const { storeOAuthTokenPayload } = functionRequire('./lib/oauthTokenStore.js') as {
  storeOAuthTokenPayload: (manager: OAuthTokenSecretManager, parent: string, payload: string, metadata: OAuthTokenMetadataStore, prune: boolean) => Promise<void>
}
const projectId = 'demo-ieppurchase-freee-test'
const tokenParent = `projects/${projectId}/secrets/FREEE_OAUTH_TOKENS`
const tokenVersion = `${tokenParent}/versions/18`
let env: RulesTestEnvironment
let app: ReturnType<typeof initializeApp>
let db: ReturnType<typeof getFirestore>
const source = { rfqId: 'rfq', rfqItemId: 'item', lineNo: 1, partNumber: 'A-1', quantity: 2, unit: 'pcs', originalDescription: 'ボルト', translatedDescription: 'Bolt', outputDescription: 'Bolt' }
const settings: QuoteSettings = { partnerId: '123', quotationDate: '2026-09-14', expirationDate: '', subject: 'Test', quotationNumber: '', partnerTitle: '御中', taxEntryMethod: 'out', taxFraction: 'omit', lineAmountFraction: 'omit', note: '', translationsReviewed: false, prices: [{ rfqItemId: 'item', purchaseAmount: '', shippingFee: '', margin: '1.2', unitPrice: '100', taxRate: 10, reducedTaxRate: false }] }
const run = (call: Callable, data: Record<string, unknown>, uid = 'user') => call.run({ auth: { uid }, data: { rfqId: 'rfq', ...data } })
const save = (expectedRevision = 0) => run(saveSalesQuotePricing, { settings, expectedRevision })
const send = (saved: Saved) => run(sendFreeeQuotation, { revision: saved.revision, digest: saved.digest, confirm: true })
const ref = () => db.doc('salesQuotes/rfq/freeeExports/current')
const successfulResponse = (saved: Saved) => ({ quotation: { ...saved.payload, id: 99, quotation_number: 'Q-99', lines: saved.payload.lines, total_amount: saved.preview.total, amount_tax: saved.preview.tax, sending_status: 'unsent', cancel_status: 'uncanceled', report_url: 'https://invoice.freee.co.jp/reports/99' } })

beforeAll(async () => {
  const hostValue = process.env.FIRESTORE_EMULATOR_HOST
  if (!hostValue || !/^(127\.0\.0\.1|localhost):\d+$/.test(hostValue)) throw new Error('Local emulator is required. No production access is allowed.')
  const [host, port] = hostValue.split(':')
  vi.stubEnv('GCLOUD_PROJECT', projectId)
  app = initializeApp({ projectId }); db = getFirestore(app)
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } })
})
beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  // All Secret Manager and freee HTTP calls are replaced. Only the local DB is real.
  vi.spyOn(SecretManagerServiceClient.prototype, 'accessSecretVersion').mockImplementation(((request: { name?: string }) => Promise.resolve([{ name: request.name, payload: { data: Buffer.from(JSON.stringify({ companyId: '456', accessToken: 'FAKE', authorizedAt: new Date().toISOString(), expiresIn: 21600 })) } }])) as never)
  await env.clearFirestore()
  await db.doc(FREEE_TOKEN_METADATA_PATH).set({ currentVersion: tokenVersion, updatedAt: Timestamp.now() })
  await db.doc('rfqs/rfq').set({ rfqNumber: 'RFQ-2026-000001', status: 'quoting', customerId: 'customer', customerName: 'Customer' })
  await db.doc('rfqs/rfq/items/item').set({ manufacturerName: 'ACME' })
  await db.doc('salesQuotes/rfq').set({ rfqId: 'rfq', status: 'confirmed', confirmedAt: Timestamp.now() })
  await db.doc('salesQuotes/rfq/items/item').set({ ...source, confirmedAt: Timestamp.now() })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected HTTP request') }))
})
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await env?.cleanup(); if (app) await deleteApp(app) })

describe('freee numeric token version metadata integration', () => {
  it('uses the current numeric version when saving a quotation without reading latest', async () => {
    const access = vi.mocked(SecretManagerServiceClient.prototype.accessSecretVersion)
    await save()
    expect(access).toHaveBeenCalledTimes(1)
    expect(access).toHaveBeenCalledWith({ name: tokenVersion })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('normalizes the API project number, verifies the numeric version and stores no token values in Firestore', async () => {
    const nextVersion = `${tokenParent}/versions/19`
    const apiVersionName = 'projects/123456789012/secrets/FREEE_OAUTH_TOKENS/versions/19'
    const payload = JSON.stringify({ companyId: '456', accessToken: 'FAKE_NEW_ACCESS_SECRET', refreshToken: 'FAKE_NEW_REFRESH_SECRET', authorizedAt: new Date().toISOString(), expiresIn: 21600 })
    const add = vi.spyOn(SecretManagerServiceClient.prototype, 'addSecretVersion').mockResolvedValue([{ name: apiVersionName }] as never)
    const access = vi.mocked(SecretManagerServiceClient.prototype.accessSecretVersion).mockImplementation(((request: { name?: string }) => {
      expect(request.name).toBe(nextVersion)
      return Promise.resolve([{ name: apiVersionName, payload: { data: Buffer.from(payload) } }])
    }) as never)
    const list = vi.spyOn(SecretManagerServiceClient.prototype, 'listSecretVersions').mockResolvedValue([[]] as never)
    const destroy = vi.spyOn(SecretManagerServiceClient.prototype, 'destroySecretVersion').mockResolvedValue([{}] as never)
    await storeOAuthTokenPayload(new SecretManagerServiceClient(), tokenParent, payload, freeeTokenMetadata(tokenParent), false)
    expect(add).toHaveBeenCalledWith({ parent: tokenParent, payload: { data: Buffer.from(payload) } })
    expect(access).toHaveBeenCalledWith({ name: nextVersion })
    expect(list).not.toHaveBeenCalled()
    expect(destroy).not.toHaveBeenCalled()
    const metadata = (await db.doc(FREEE_TOKEN_METADATA_PATH).get()).data()
    expect(Object.keys(metadata ?? {}).sort()).toEqual(['currentVersion', 'updatedAt'])
    expect(metadata?.currentVersion).toBe(nextVersion)
    expect(metadata?.updatedAt).toBeInstanceOf(Timestamp)
    expect(JSON.stringify(metadata)).not.toContain('FAKE_NEW_ACCESS_SECRET')
    expect(JSON.stringify(metadata)).not.toContain('FAKE_NEW_REFRESH_SECRET')
    expect((await db.collection('integrationSecrets').get()).size).toBe(1)
  })
  it('keeps the greatest numeric version when concurrent authorizations finish out of order', async () => {
    const metadata = freeeTokenMetadata(tokenParent)
    await db.doc(FREEE_TOKEN_METADATA_PATH).delete()
    expect(await metadata.advance(`${tokenParent}/versions/9`)).toBe(true)
    await Promise.all([10, 12, 11].map(version => metadata.advance(`${tokenParent}/versions/${version}`)))
    expect(await metadata.read()).toBe(`${tokenParent}/versions/12`)
    expect(await metadata.advance(`${tokenParent}/versions/10`)).toBe(false)
    expect(await metadata.advance(`${tokenParent}/versions/12`)).toBe(false)
    expect(await metadata.read()).toBe(`${tokenParent}/versions/12`)
  })
  it('rereads metadata when a previous token version is destroyed during a request', async () => {
    const nextVersion = `${tokenParent}/versions/19`
    const access = vi.mocked(SecretManagerServiceClient.prototype.accessSecretVersion).mockImplementation((async (request: { name?: string }) => {
      if (request.name === tokenVersion) {
        await freeeTokenMetadata(tokenParent).advance(nextVersion)
        throw Object.assign(new Error('Old version was destroyed'), { code: 9 })
      }
      expect(request.name).toBe(nextVersion)
      return [{ name: nextVersion, payload: { data: Buffer.from(JSON.stringify({ companyId: '456', accessToken: 'FAKE', authorizedAt: new Date().toISOString(), expiresIn: 21600 })) } }]
    }) as never)
    await save()
    expect(access).toHaveBeenCalledTimes(2)
    expect(access).toHaveBeenNthCalledWith(1, { name: tokenVersion })
    expect(access).toHaveBeenNthCalledWith(2, { name: nextVersion })
    expect((await ref().get()).get('status')).toBe('draft')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects metadata for other secrets and aliases before accessing a credential', async () => {
    const access = vi.mocked(SecretManagerServiceClient.prototype.accessSecretVersion)
    for (const currentVersion of [`${tokenParent}/versions/latest`, `projects/${projectId}/secrets/OTHER/versions/19`, `${tokenParent}/versions/0`]) {
      await db.doc(FREEE_TOKEN_METADATA_PATH).update({ currentVersion })
      await expect(save()).rejects.toMatchObject({ code: 'failed-precondition' })
    }
    expect(access).not.toHaveBeenCalled()
    expect((await ref().get()).exists).toBe(false)
  })
  it('denies direct metadata reads, listing and writes to authenticated and anonymous clients', async () => {
    for (const client of [env.authenticatedContext('user').firestore(), env.unauthenticatedContext().firestore()]) {
      const metadata = doc(client, FREEE_TOKEN_METADATA_PATH)
      await assertFails(getDoc(metadata))
      await assertFails(getDocs(collection(client, 'integrationSecrets')))
      await assertFails(setDoc(metadata, { currentVersion: `${tokenParent}/versions/999` }))
      await assertFails(updateDoc(metadata, { currentVersion: `${tokenParent}/versions/999` }))
      await assertFails(deleteDoc(metadata))
      await assertFails(setDoc(doc(client, 'integrationSecrets/forged'), { currentVersion: `${tokenParent}/versions/999` }))
    }
    expect((await db.doc(FREEE_TOKEN_METADATA_PATH).get()).get('currentVersion')).toBe(tokenVersion)
  })
})

describe('freee quotation transaction and authorization integration', () => {
  it('builds the two-line memo from the stored RFQ and keeps identical saved versions distinguishable', async () => {
    const first = await run(saveSalesQuotePricing, { settings, expectedRevision: 0, rfqNumber: 'FORGED', memo: 'FORGED' })
    expect(first.payload.memo).toBe('案件リンク：https://ieppurchase.web.app/rfqs/rfq?freeeExportRevision=1\n案件番号：RFQ-2026-000001')
    const next = await save(1)
    expect(next.payload.lines).toEqual(first.payload.lines)
    expect(next.payload.memo).not.toBe(first.payload.memo)
    expect((await ref().collection('revisions').doc('1').get()).get('payload.memo')).toBe(first.payload.memo)
    await db.doc('rfqs/rfq').update({ rfqNumber: '' })
    await expect(save(2)).rejects.toMatchObject({ code: 'failed-precondition' })
    expect((await ref().get()).get('revision')).toBe(2)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('still reconciles a legacy marker-only memo without rewriting it', async () => {
    const saved = await save()
    saved.payload.memo = saved.marker
    await ref().update({ payload: saved.payload, status: 'uncertain', startedAt: Timestamp.fromMillis(Date.now() - 121_000) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(successfulResponse(saved)))))
    expect((await run(reconcileFreeeQuotation, { quotationId: 99 })).status).toBe('sent')
    expect((await ref().get()).get('payload.memo')).toBe(saved.marker)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('requires authentication and explicit send confirmation before credentials or HTTP', async () => {
    for (const call of [saveSalesQuotePricing, sendFreeeQuotation, reconcileFreeeQuotation, startSalesQuoteRevision]) await expect(call.run({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' })
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
  it('validates the new cost divisor on the server while preserving the previous saved revision', async () => {
    await save()
    const previous = (await ref().collection('revisions').doc('1').get()).data()
    const price = { ...settings.prices[0], purchaseAmount: '1000', shippingFee: '100', margin: '1.2', unitPrice: '1400' }
    for (const invalid of [{ ...price, unitPrice: '1300' }, { ...price, margin: '2' }, { ...price, margin: '2.1' }]) {
      await expect(run(saveSalesQuotePricing, { expectedRevision: 1, settings: { ...settings, prices: [invalid] } })).rejects.toMatchObject({ code: 'invalid-argument' })
    }
    expect((await ref().get()).get('revision')).toBe(1)
    const next = await run(saveSalesQuotePricing, { expectedRevision: 1, settings: { ...settings, prices: [price] } })
    expect(next.preview).toMatchObject({ subtotal: 2800, tax: 280, total: 3080 })
    expect(next.payload.lines[0]).toMatchObject({ unit_price: '1400', tax_rate: 10 })
    expect((await ref().collection('revisions').doc('1').get()).data()).toEqual(previous)
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
  it('blocks legacy multiline payloads before POST and preserves history on resave', async () => {
    const old = await save()
    old.payload.lines[0].description = 'A-1\nBolt'
    old.preview.lines[0].description = 'A-1\nBolt'
    await ref().update({ payload: old.payload, preview: old.preview, status: 'failed' })
    await ref().collection('revisions').doc('1').update({ payload: old.payload, preview: old.preview })
    await expect(send(old)).rejects.toThrow('新しい版')
    expect(fetch).not.toHaveBeenCalled()
    expect((await ref().get()).get('status')).toBe('failed')
    const next = await save(1)
    expect(next.payload.lines[0].description).toBe('ACME A-1 Bolt')
    expect((await ref().collection('revisions').doc('1').get()).get('payload.lines')[0].description).toBe('A-1\nBolt')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(successfulResponse(next)))))
    expect((await send(next)).status).toBe('sent')
    expect(fetch).toHaveBeenCalledTimes(1)
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

describe('P3-005 invalid translated quotation acceptance', () => {
  it('rejects overlong and unreviewed missing translations before saving or sending', async () => {
    await db.doc('salesQuotes/rfq/items/item').update({ outputDescription: 'x'.repeat(252) })
    await expect(save()).rejects.toThrow('255')
    expect((await ref().get()).exists).toBe(false)
    await db.doc('salesQuotes/rfq/items/item').update({ outputDescription: 'Manually checked bolt', translatedDescription: '' })
    await expect(save()).rejects.toThrow('翻訳確認')
    expect((await ref().get()).exists).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

// P3-005: verify multiple translated lines at the actual HTTP boundary.
describe('P3-005 multiple translated lines', () => {
  it('retains Unicode, newlines, money and immutable history after RFQ edits', async () => {
    await db.doc('salesQuotes/rfq/items/item').update({ outputDescription: 'Hex bolt\nStainless steel' })
    await db.doc('salesQuotes/rfq/items/second').set({ ...source, rfqItemId: 'second', lineNo: 2, partNumber: '0002-Ω', quantity: 1.5, originalDescription: 'ワッシャー', translatedDescription: '', outputDescription: 'Washer Ø10\nFor M10 bolt', confirmedAt: Timestamp.now() })
    const saved = await run(saveSalesQuotePricing, { expectedRevision: 0, settings: { ...settings, translationsReviewed: true, prices: [...settings.prices, { rfqItemId: 'second', unitPrice: '80', taxRate: 8, reducedTaxRate: false }] } })
    expect(saved.preview).toMatchObject({ subtotal: 320, tax: 29, total: 349 })
    expect(saved.preview.warnings).toHaveLength(1)
    const snapshot = (await ref().collection('revisions').doc('1').get()).data()
    await db.doc('rfqs/rfq/items/item').set({ originalDescription: '変更後', translatedDescription: 'Changed', partNumber: 'OTHER', quantity: 99 })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as FreeeQuotePayload
      expect(body.lines).toEqual([
        { type: 'item', description: 'ACME A-1 Hex bolt Stainless steel', quantity: 2, unit: 'pcs', unit_price: '100', tax_rate: 10, reduced_tax_rate: false, withholding: false },
        { type: 'item', description: '0002-Ω Washer Ø10 For M10 bolt', quantity: 1.5, unit: 'pcs', unit_price: '80', tax_rate: 8, reduced_tax_rate: false, withholding: false },
      ])
      return new Response(JSON.stringify({ quotation: { ...successfulResponse(saved).quotation, total_amount: 349, amount_tax: 29 } }))
    }))
    await send(saved); await send(saved)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((await ref().get()).get('result.verification')).toBe('matched')
    expect((await ref().collection('revisions').doc('1').get()).data()).toEqual(snapshot)
    const events = await ref().collection('events').get()
    expect(events.docs.map(d => d.get('action')).sort()).toEqual(['saved', 'sending', 'sent'])
    expect(events.docs.every(d => d.get('revision') === 1 && d.get('userId') === 'user' && d.get('createdAt') instanceof Timestamp)).toBe(true)
  })
})

describe('freee partner name selection', () => {
  const { searchFreeePartners } = functionRequire('./lib/freeeQuotation.js') as Record<string, Callable>
  it('searches the connected company with paging and returns only selection fields', async () => {
    await expect(searchFreeePartners.run({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(run(searchFreeePartners, { offset: -1 })).rejects.toMatchObject({ code: 'invalid-argument' })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const u = new URL(url)
      expect(u.pathname).toBe('/api/1/partners')
      expect(u.searchParams.get('company_id')).toBe('456')
      expect(u.searchParams.get('keyword')).toBe('A & B')
      expect(u.searchParams.get('offset')).toBe('50')
      expect(init.method).toBe('GET')
      return new Response(JSON.stringify({ partners: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: 'Partner', code: null, available: true, bank_account_number: 'PRIVATE' })) }))
    }))
    const result = await run(searchFreeePartners, { keyword: 'A & B', offset: 50, companyId: 999 })
    expect(result).toMatchObject({ companyId: 456, nextOffset: 100 })
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
  it('verifies the selected partner and stores the server-provided name in its revision', async () => {
    await expect(run(saveSalesQuotePricing, { settings, expectedRevision: 0, partnerCompanyId: 999 })).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(fetch).not.toHaveBeenCalled()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.freee.co.jp/api/1/partners/123?company_id=456')
      expect(init.method).toBe('GET')
      return new Response(JSON.stringify({ partner: { id: 123, name: 'Actual partner', code: null, available: true } }))
    }))
    await run(saveSalesQuotePricing, { settings, expectedRevision: 0, partnerCompanyId: 456, partnerName: 'Forged' })
    expect((await ref().get()).get('partnerName')).toBe('Actual partner')
    expect((await ref().collection('revisions').doc('1').get()).get('partnerName')).toBe('Actual partner')
    expect((await ref().get()).get('payload.partner_id')).toBe(123)
  })
  it('refuses unavailable or mismatched partners and safely reports permission failures', async () => {
    for (const partner of [{ id: 123, name: 'Archived', available: false }, { id: 999, name: 'Wrong' }]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ partner }))))
      await expect(run(saveSalesQuotePricing, { settings, expectedRevision: 0, partnerCompanyId: 456 })).rejects.toMatchObject({ code: 'failed-precondition' })
      expect((await ref().get()).exists).toBe(false)
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('PRIVATE', { status: 403 })))
    await expect(run(searchFreeePartners, {})).rejects.toThrow('参照')
    await expect(run(searchFreeePartners, {})).rejects.not.toThrow('PRIVATE')
  })
  it('handles empty results, unavailable partners, expired sessions and broken responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ partners: [{ id: 1, name: 'Archived', available: false }] }))))
    await expect(run(searchFreeePartners, {})).resolves.toMatchObject({ partners: [], nextOffset: null })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    await expect(run(searchFreeePartners, {})).rejects.toThrow('再認可')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    await expect(run(searchFreeePartners, {})).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('quotation revisions and updates', () => {
  const revise = (saved: Saved, customerPresented = false) => run(startSalesQuoteRevision, {
    expectedRevision: saved.revision, digest: saved.digest, customerPresented,
  })
  async function sentQuote() {
    const saved = await save()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(successfulResponse(saved)))))
    await send(saved)
    return saved
  }
  async function confirmAndSave(expectedRevision = 1, outputDescription = 'Revised bolt') {
    await db.doc('salesQuotes/rfq').update({ status: 'confirmed', confirmedAt: Timestamp.now() })
    await db.doc('salesQuotes/rfq/items/item').update({ outputDescription, confirmedAt: Timestamp.now() })
    return save(expectedRevision)
  }
  it('revises a sent legacy memo to the new two-line memo using the same freee ID and preserving the old snapshot', async () => {
    const original = await save()
    original.payload.memo = original.marker
    original.digest = createHash('sha256').update(JSON.stringify({ payload: original.payload, preview: original.preview })).digest('hex')
    await ref().update({ payload: original.payload, digest: original.digest })
    await ref().collection('revisions').doc('1').update({ payload: original.payload, digest: original.digest })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(successfulResponse(original)))))
    await send(original)
    const snapshot = (await ref().collection('revisions').doc('1').get()).data()
    await revise(original)
    const next = await confirmAndSave(1, source.outputDescription)
    expect(next.payload.memo).toBe('案件リンク：https://ieppurchase.web.app/rfqs/rfq?freeeExportRevision=2\n案件番号：RFQ-2026-000001')
    const http = vi.fn(async (url: string, init: RequestInit) => {
      if (!init.method) return new Response(JSON.stringify(successfulResponse(original)))
      expect(url).toBe('https://api.freee.co.jp/iv/quotations/99')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(String(init.body)).memo).toBe(next.payload.memo)
      return new Response(JSON.stringify(successfulResponse(next)))
    })
    vi.stubGlobal('fetch', http)
    expect((await send(next)).status).toBe('sent')
    expect(http).toHaveBeenCalledTimes(2)
    expect((await ref().get()).get('result.id')).toBe(99)
    expect((await ref().collection('revisions').doc('1').get()).data()).toEqual(snapshot)
  })
  it('reopens a saved draft, blocks its old send preview and preserves its immutable revision', async () => {
    const original = await save(), snapshot = (await ref().collection('revisions').doc('1').get()).data()
    await revise(original)
    expect((await ref().get()).data()).toMatchObject({ editing: true, status: 'draft', operation: 'create' })
    expect((await db.doc('salesQuotes/rfq').get()).get('status')).toBe('draft')
    expect((await db.doc('salesQuotes/rfq/items/item').get()).get('confirmedAt')).toBe(null)
    await expect(send(original)).rejects.toThrow('編集中')
    const next = await confirmAndSave()
    expect(next.revision).toBe(2)
    expect(next.editing).toBe(false)
    expect(next.payload.lines[0].description).toBe('ACME A-1 Revised bolt')
    expect((await ref().collection('revisions').doc('1').get()).data()).toEqual(snapshot)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('updates the same ID with one PUT, never POST, even under concurrent sends and repeated revisions', async () => {
    const original = await sentQuote(), snapshot = (await ref().collection('revisions').doc('1').get()).data()
    await revise(original)
    expect((await ref().get()).get('lastSentRevision')).toBe(1)
    const next = await confirmAndSave()
    const http = vi.fn(async (url: string, init: RequestInit) => {
      if (!init.method) return new Response(JSON.stringify(successfulResponse(original)))
      expect(url).toBe('https://api.freee.co.jp/iv/quotations/99')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(String(init.body))).toMatchObject({ memo: next.payload.memo, lines: next.payload.lines })
      return new Response(JSON.stringify(successfulResponse(next)))
    })
    vi.stubGlobal('fetch', http)
    const sends = await Promise.allSettled([send(next), send(next)])
    expect(sends.some(result => result.status === 'fulfilled')).toBe(true)
    expect(http.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1)
    await send(next)
    expect(http).toHaveBeenCalledTimes(2)
    expect((await ref().get()).data()).toMatchObject({ status: 'sent', result: { id: 99 }, lastSentRevision: 2 })
    expect((await ref().collection('revisions').doc('1').get()).data()).toEqual(snapshot)
    const events = await ref().collection('events').get()
    expect(events.docs.filter(event => event.get('action') === 'sent').map(event => [event.get('revision'), event.get('result.id')]).sort()).toEqual([[1, 99], [2, 99]])
    await revise(next)
    const third = await confirmAndSave(2)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify(successfulResponse(init.method ? third : next)))))
    await send(third)
    expect((await ref().get()).get('result.id')).toBe(99)
  })
  it('creates a separate revised quotation only after explicit customer-presentation selection', async () => {
    const original = await sentQuote()
    await expect(run(startSalesQuoteRevision, { expectedRevision: 1, digest: original.digest })).rejects.toMatchObject({ code: 'invalid-argument' })
    await revise(original, true)
    const next = await confirmAndSave()
    expect((await ref().get()).data()).toMatchObject({ operation: 'create', updateTarget: null, previousResult: { id: 99 } })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.freee.co.jp/iv/quotations'); expect(init.method).toBe('POST')
      return new Response(JSON.stringify({ quotation: { ...successfulResponse(next).quotation, id: 100, quotation_number: 'Q-100' } }))
    }))
    await send(next)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((await ref().get()).get('result.id')).toBe(100)
    expect((await ref().get()).get('previousResult.id')).toBe(99)
    expect((await ref().collection('revisions').doc('1').get()).get('payload.memo')).toBe(original.payload.memo)
  })
  it('refuses concurrent or stale revision requests and rejects editing during unknown transfers', async () => {
    const original = await sentQuote()
    const starts = await Promise.allSettled([revise(original), revise(original)])
    expect(starts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const next = await confirmAndSave()
    await expect(revise(original)).rejects.toMatchObject({ code: 'aborted' })
    for (const status of ['sending', 'uncertain']) {
      await ref().update({ status })
      await expect(revise(next)).rejects.toMatchObject({ code: 'failed-precondition' })
    }
  })
  it('detects manual freee changes, sent/cancelled state and inaccessible IDs before any PUT or POST', async () => {
    const original = await sentQuote()
    await revise(original)
    const next = await confirmAndSave()
    for (const change of [{ subject: 'Manual subject' }, { quotation_note: 'Manual note' }, { lines: [] }, { sending_status: 'sent' }, { cancel_status: 'canceled' }, { sending_status: null }, { template_id: 999 }]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ quotation: { ...successfulResponse(original).quotation, ...change } }))))
      expect((await send(next)).status).toBe('failed')
      expect(fetch).toHaveBeenCalledTimes(1)
      expect((await ref().get()).get('result')).toBe(null)
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    expect((await send(next)).status).toBe('failed')
    expect(fetch).toHaveBeenCalledTimes(1)
    // A customer-presented quotation can be switched to a deliberate new revision.
    await revise(next, true)
    expect((await ref().get()).get('updateTarget')).toBe(null)
  })
  it('preserves freee template, addresses and contacts when updating', async () => {
    const original = await save()
    const extra = { template_id: 17, branch_no: 0, partner_address_zipcode: '100-0001', partner_contact_name: 'Contact', company_contact_name: 'Owner' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ quotation: { ...successfulResponse(original).quotation, ...extra } }))))
    await send(original); await revise(original)
    const next = await confirmAndSave()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method) expect(JSON.parse(String(init.body))).toMatchObject(extra)
      return new Response(JSON.stringify({ quotation: { ...successfulResponse(init.method ? next : original).quotation, ...extra } }))
    }))
    expect((await send(next)).status).toBe('sent')
  })
  it('keeps PUT timeouts locked and rejects the previous memo even with identical lines and amounts', async () => {
    const original = await sentQuote()
    await revise(original)
    const next = await confirmAndSave(1, source.outputDescription)
    expect(next.payload.lines).toEqual(original.payload.lines)
    expect(next.preview.total).toBe(original.preview.total)
    expect(next.payload.memo).not.toBe(original.payload.memo)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (!init.method) return new Response(JSON.stringify(successfulResponse(original)))
      throw new Error('timeout after PUT')
    }))
    expect((await send(next)).status).toBe('uncertain')
    expect(fetch).toHaveBeenCalledTimes(2)
    await expect(send(next)).rejects.toMatchObject({ code: 'failed-precondition' })
    await expect(revise(next)).rejects.toMatchObject({ code: 'failed-precondition' })
    await ref().update({ startedAt: Timestamp.fromMillis(Date.now() - 121_000) })
    await expect(run(reconcileFreeeQuotation, { quotationId: 100 })).rejects.toMatchObject({ code: 'failed-precondition' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(successfulResponse(original)))))
    await expect(run(reconcileFreeeQuotation, { quotationId: 99 })).rejects.toMatchObject({ code: 'failed-precondition' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(successfulResponse(next)))))
    expect((await run(reconcileFreeeQuotation, { quotationId: 99 })).status).toBe('sent')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects altered update targets, company changes and quotation numbers instead of falling back to POST', async () => {
    const original = await sentQuote()
    await revise(original)
    await db.doc('salesQuotes/rfq').update({ status: 'confirmed' })
    await db.doc('salesQuotes/rfq/items/item').update({ confirmedAt: Timestamp.now() })
    await expect(run(saveSalesQuotePricing, { expectedRevision: 1, settings: { ...settings, quotationNumber: 'OTHER' } })).rejects.toThrow('番号')
    await expect(run(saveSalesQuotePricing, { expectedRevision: 1, settings: { ...settings, partnerId: '999' } })).rejects.toThrow('取引先')
    await db.doc('rfqs/rfq').update({ customerId: 'other' })
    await expect(save(1)).rejects.toThrow('顧客')
    await db.doc('rfqs/rfq').update({ customerId: 'customer' })
    const next = await save(1)
    await ref().update({ updateTarget: null })
    await expect(send(next)).rejects.toThrow('新規作成は行いません')
  })
})
