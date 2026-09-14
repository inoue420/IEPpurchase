import { describe, expect, it } from 'vitest'
import { buildQuotePreview, parseQuoteSettings, toFreeePayload, type ConfirmedLine } from '../../../functions/src/salesQuoteModel'
import { createFreeeQuotation, freeeResult } from '../../../functions/src/freeeQuotationTransport'

const line: ConfirmedLine = { rfqItemId: 'a', lineNo: 1, partNumber: 'B-01', quantity: 2, unit: 'pcs', originalDescription: '六角ボルト', translatedDescription: 'Hex bolt', outputDescription: 'Hex bolt\nStainless steel' }
const settings = (change: Record<string, unknown> = {}) => parseQuoteSettings({ partnerId: '123', quotationDate: '2026-09-14', expirationDate: '', subject: 'Quotation', quotationNumber: '', partnerTitle: '御中', taxEntryMethod: 'out', taxFraction: 'omit', lineAmountFraction: 'omit', note: '', translationsReviewed: false, prices: [{ rfqItemId: 'a', unitPrice: '100.125', taxRate: 10, reducedTaxRate: false }], ...change })
const preview = () => buildQuotePreview(settings(), [line])
const payload = () => toFreeePayload(preview(), 456, 'IEPpurchase:rfq:v1')
const response = (change: Record<string, unknown> = {}) => ({ quotation: { id: 1, quotation_number: 'Q-1', company_id: 456, partner_id: 123, total_amount: 220, amount_tax: 20, lines: payload().lines, report_url: 'https://invoice.freee.co.jp/reports/1', ...change } })

describe('sales quote calculations and immutable translated lines', () => {
  it('keeps descriptions, newlines, part numbers, quantities and prices without retranslation', () => {
    const original = structuredClone(line), p = preview(), data = payload()
    expect(line).toEqual(original)
    expect(p).toMatchObject({ subtotal: 200, tax: 20, total: 220 })
    expect(data.lines[0]).toMatchObject({ description: 'B-01\nHex bolt\nStainless steel', quantity: 2, unit: 'pcs', unit_price: '100.125', withholding: false })
    expect(data).not.toHaveProperty('expiration_date')
    expect(data).not.toHaveProperty('quotation_number')
    expect(JSON.stringify(data)).not.toContain('六角ボルト')
  })
  it('rounds tax once per rate group, including inclusive prices', () => {
    const two = [line, { ...line, rfqItemId: 'b', lineNo: 2 }]
    const prices = two.map(s => ({ rfqItemId: s.rfqItemId, unitPrice: '3', taxRate: 10, reducedTaxRate: false }))
    expect(buildQuotePreview(settings({ prices }), two)).toMatchObject({ subtotal: 12, tax: 1, total: 13 })
    expect(buildQuotePreview(settings({ taxEntryMethod: 'in', prices }), two)).toMatchObject({ subtotal: 11, tax: 1, total: 12 })
  })
  it('uses exact decimal arithmetic and each selectable rounding mode', () => {
    const source = [{ ...line, quantity: 0.005 }]
    expect(buildQuotePreview(settings(), source).total).toBe(0)
    expect(buildQuotePreview(settings({ lineAmountFraction: 'round', taxFraction: 'round_up' }), source)).toMatchObject({ subtotal: 1, tax: 1, total: 2 })
    const prices = [{ rfqItemId: 'a', unitPrice: '1.999', taxRate: 0, reducedTaxRate: false }]
    expect(buildQuotePreview(settings({ prices }), [{ ...line, quantity: 1000 }]).total).toBe(1999)
  })
  it('keeps reduced and normal 8% tax groups separate and handles mixed rates', () => {
    const source = [line, { ...line, rfqItemId: 'b' }, { ...line, rfqItemId: 'c' }]
    const prices = [
      { rfqItemId: 'a', unitPrice: '4', taxRate: 8, reducedTaxRate: true },
      { rfqItemId: 'b', unitPrice: '4', taxRate: 8, reducedTaxRate: false },
      { rfqItemId: 'c', unitPrice: '50', taxRate: 10, reducedTaxRate: false },
    ]
    expect(buildQuotePreview(settings({ prices }), source)).toMatchObject({ subtotal: 116, tax: 10, total: 126 })
  })
  it('rejects missing or duplicate lines, invalid dates, prices and tax', () => {
    for (const change of [{ partnerId: '1.2' }, { quotationDate: '2026-02-30' }, { expirationDate: '2026-09-13' }, { taxFraction: 'unknown' }, { prices: [] }]) expect(() => settings(change)).toThrow()
    for (const unitPrice of ['', '-1', '1.0001', '1e2', '1000000001']) expect(() => settings({ prices: [{ rfqItemId: 'a', unitPrice, taxRate: 10, reducedTaxRate: false }] })).toThrow()
    expect(() => settings({ prices: [{ rfqItemId: 'a', unitPrice: '1', taxRate: 10, reducedTaxRate: true }] })).toThrow()
    expect(() => buildQuotePreview(settings(), [])).toThrow()
    expect(() => buildQuotePreview(settings(), [{ ...line, rfqItemId: 'missing' }])).toThrow()
  })
  it('accepts a leading-zero numeric freee partner ID and sends its numeric value', () => {
    const p = buildQuotePreview(settings({ partnerId: '00000111111' }), [line])
    expect(toFreeePayload(p, 456, 'marker').partner_id).toBe(111111)
  })
  it('rejects too long descriptions without truncating, accepts exactly 255 code points', () => {
    expect(buildQuotePreview(settings(), [{ ...line, partNumber: '', outputDescription: 'x'.repeat(255) }]).lines[0].description.length).toBe(255)
    expect(() => buildQuotePreview(settings(), [{ ...line, outputDescription: 'x'.repeat(255) }])).toThrow('255')
    expect(() => buildQuotePreview(settings(), [{ ...line, outputDescription: ' ' }])).toThrow()
    expect(() => buildQuotePreview(settings(), [{ ...line, quantity: 0.0001 }])).toThrow('数量')
    expect(() => buildQuotePreview(settings(), [{ ...line, quantity: 100_000_000 }])).toThrow('数量')
  })
  it('requires explicit review for missing English and Japanese output', () => {
    for (const source of [{ ...line, translatedDescription: '' }, { ...line, outputDescription: 'ボルト' }]) {
      expect(() => buildQuotePreview(settings(), [source])).toThrow('翻訳確認')
      expect(buildQuotePreview(settings({ translationsReviewed: true }), [source]).warnings).toHaveLength(1)
    }
  })
})
describe('freee transport uses fake requests only', () => {
  it('maps the successful response and performs exactly one POST', async () => {
    let calls = 0
    const fetcher: typeof fetch = async (url, init) => {
      calls++; expect(url).toBe('https://api.freee.co.jp/iv/quotations'); expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual(payload())
      return new Response(JSON.stringify(response()))
    }
    await expect(createFreeeQuotation(payload(), 'fake', 220, 20, fetcher)).resolves.toMatchObject({ id: 1, verification: 'matched' })
    expect(calls).toBe(1)
  })
  it.each([400, 401, 403, 404, 422, 429])('allows a manual retry after explicit HTTP %i rejection without exposing upstream content', async status => {
    await expect(createFreeeQuotation(payload(), 'SECRET', 220, 20, async () => new Response('SECRET body', { status }))).rejects.toMatchObject({ retryable: true })
    await expect(createFreeeQuotation(payload(), 'SECRET', 220, 20, async () => new Response('SECRET body', { status }))).rejects.not.toThrow('SECRET')
  })
  it.each([408, 500, 502, 503])('treats HTTP %i as uncertain', async status => {
    await expect(createFreeeQuotation(payload(), 'fake', 220, 20, async () => new Response('', { status }))).rejects.toMatchObject({ retryable: false })
  })
  it('does not retry a timeout, lost connection, or malformed success', async () => {
    let calls = 0
    await expect(createFreeeQuotation(payload(), 'fake', 220, 20, async () => { calls++; throw new Error('SECRET') })).rejects.toMatchObject({ retryable: false })
    expect(calls).toBe(1)
    await expect(createFreeeQuotation(payload(), 'fake', 220, 20, async () => new Response('{}'))).rejects.toMatchObject({ retryable: false })
  })
  it('flags amount/text mismatches and refuses untrusted report links', () => {
    expect(freeeResult(response({ total_amount: 999 }), payload(), 220, 20).verification).toBe('needs_review')
    expect(freeeResult(response({ lines: [{ ...payload().lines[0], description: 'changed' }] }), payload(), 220, 20).verification).toBe('needs_review')
    expect(freeeResult(response({ report_url: 'https://freee.co.jp.attacker.test/a' }), payload(), 220, 20).reportUrl).toBe('')
  })
})
