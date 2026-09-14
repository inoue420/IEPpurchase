import { describe, expect, it } from 'vitest'
import { salesQuoteSettingsEqual } from './salesQuoteSettingsEqual'
import type { QuoteSettings } from '../../../functions/src/salesQuoteModel'
const settings: QuoteSettings = { partnerId: '110368088', quotationDate: '2026-09-14', expirationDate: '2026-10-14', subject: 'APIテスト', quotationNumber: '', partnerTitle: '御中', taxEntryMethod: 'out', taxFraction: 'omit', lineAmountFraction: 'omit', note: '', translationsReviewed: true, prices: [{ rfqItemId: 'a', unitPrice: '10000', taxRate: 10, reducedTaxRate: false }, { rfqItemId: 'b', unitPrice: '80', taxRate: 8, reducedTaxRate: false }] }
describe('sales quote saved change detection', () => {
  it('ignores Firestore key ordering and price row ordering without mutating input', () => {
    const reordered = Object.fromEntries(Object.entries(settings).reverse()) as unknown as QuoteSettings
    reordered.prices = settings.prices.map(p => Object.fromEntries(Object.entries(p).reverse()) as unknown as QuoteSettings['prices'][number]).reverse()
    const before = JSON.stringify(reordered)
    expect(JSON.stringify(settings)).not.toBe(before)
    expect(salesQuoteSettingsEqual(settings, reordered)).toBe(true)
    expect(salesQuoteSettingsEqual(reordered, settings)).toBe(true)
    expect(JSON.stringify(reordered)).toBe(before)
  })
  it('still detects header, partner, review, price and line changes', () => {
    for (const change of [{ subject: '変更' }, { partnerId: '2' }, { translationsReviewed: false }, { taxFraction: 'round' as const }, { note: '備考' }, { expirationDate: '' }]) expect(salesQuoteSettingsEqual({ ...settings, ...change }, settings)).toBe(false)
    expect(salesQuoteSettingsEqual({ ...settings, prices: [{ ...settings.prices[0], unitPrice: '9999' }, settings.prices[1]] }, settings)).toBe(false)
    expect(salesQuoteSettingsEqual({ ...settings, prices: [settings.prices[0]] }, settings)).toBe(false)
  })
  it('treats invalid unsaved input as changed', () => {
    expect(salesQuoteSettingsEqual({ ...settings, partnerId: '' }, settings)).toBe(false)
    expect(salesQuoteSettingsEqual({ ...settings, prices: [{ ...settings.prices[0], unitPrice: '' }] }, settings)).toBe(false)
  })
})
