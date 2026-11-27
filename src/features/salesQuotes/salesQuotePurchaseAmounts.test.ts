import { describe, expect, it } from 'vitest'
import { buildQuotePreview, parseQuoteSettings, toFreeePayload, type QuotePrice, type QuoteSettings } from '../../../functions/src/salesQuoteModel'
import type { EcPurchaseCandidate } from '../rfqs/rfqItemRepository'
import { fillSalesQuotePurchaseAmounts, getPurchaseAmountSuggestions, getPurchaseAmountUpdate } from './salesQuotePurchaseAmounts'

const blankPrice: QuotePrice = { rfqItemId: 'a', purchaseAmount: '', shippingFee: '', margin: '1.2', unitPrice: '', taxRate: 10, reducedTaxRate: false }
const settings: QuoteSettings = {
  partnerId: '1', quotationDate: '2026-11-27', expirationDate: '', subject: 'Quote', quotationNumber: '', partnerTitle: '御中',
  taxEntryMethod: 'out', taxFraction: 'omit', lineAmountFraction: 'omit', note: '', translationsReviewed: false, prices: [blankPrice],
}
const candidate = (price: number, purchasePlanned: boolean): EcPurchaseCandidate =>
  ({ price, purchasePlanned, storeProductName: 'Item', url: 'https://example.test/item' })
const sourceItem = {
  id: 'a', supplierResponseUnitPrice: 4200, ecPurchaseCandidates: [] as EcPurchaseCandidate[], archivedAt: null, status: 'quoted' as const,
}

describe('販売見積の購入金額', () => {
  it('仕入先回答単価を空欄に取り込み、数量を掛ける前の販売単価を計算する', () => {
    const result = fillSalesQuotePurchaseAmounts(settings, getPurchaseAmountSuggestions([sourceItem]))
    expect(result.prices[0]).toMatchObject({ purchaseAmount: '4200', purchaseAmountSource: 'supplier', unitPrice: '5300' })
    expect(settings.prices[0]).toEqual(blankPrice)
    const preview = buildQuotePreview(parseQuoteSettings(result), [{
      rfqItemId: 'a', lineNo: 6, partNumber: 'F-01356', quantity: 5, unit: '個',
      originalDescription: 'ピンネイル', translatedDescription: 'Pin Nail', outputDescription: 'Pin Nail',
    }])
    expect(preview.settings.prices[0].purchaseAmountSource).toBe('supplier')
    expect(preview.lines[0].amount).toBe(26500)
    const payload = toFreeePayload(preview, 1, 'Quote')
    expect(payload.lines[0]).toMatchObject({ quantity: 5, unit_price: '5300' })
    expect(payload.lines[0]).not.toHaveProperty('purchaseAmountSource')
  })

  it('購入予定のEC候補を合計して優先し、未選択の候補は除く', () => {
    const suggestions = getPurchaseAmountSuggestions([{
      ...sourceItem, ecPurchaseCandidates: [candidate(1000, true), candidate(2000, true), candidate(500, false)],
    }])
    expect(fillSalesQuotePurchaseAmounts(settings, suggestions).prices[0])
      .toMatchObject({ purchaseAmount: '3000', purchaseAmountSource: 'ec', unitPrice: '3800' })
  })

  it('0円を価格として扱い、回答なしやキャンセル品目は空欄を維持する', () => {
    const suggestions = getPurchaseAmountSuggestions([
      { ...sourceItem, supplierResponseUnitPrice: 0, ecPurchaseCandidates: [candidate(100, false)] },
      { ...sourceItem, id: 'unquoted', supplierResponseUnitPrice: null },
      { ...sourceItem, id: 'cancelled', status: 'cancelled' },
    ])
    expect(suggestions.get('a')).toEqual({ purchaseAmount: '0', purchaseAmountSource: 'supplier' })
    expect(suggestions.size).toBe(1)
    expect(fillSalesQuotePurchaseAmounts(settings, suggestions).prices[0].unitPrice).toBe('0')
    expect(fillSalesQuotePurchaseAmounts(settings, new Map())).toBe(settings)
  })

  it('仕入先回答やEC購入予定の更新で、入力済みの金額を自動で上書きしない', () => {
    const nonemptyPrices: QuotePrice[] = [
      { ...blankPrice, purchaseAmount: '4000', unitPrice: '5000' },
      { ...blankPrice, purchaseAmount: '4000', unitPrice: '5000', purchaseAmountSource: 'manual' },
      { ...blankPrice, purchaseAmount: '4000', unitPrice: '5000', purchaseAmountSource: 'supplier' },
      { ...blankPrice, purchaseAmount: '4000', unitPrice: '5000', purchaseAmountSource: 'ec' },
      { ...blankPrice, unitPrice: '5000' },
      { ...blankPrice, purchaseAmountSource: 'manual' },
    ]
    const supplier = getPurchaseAmountSuggestions([sourceItem])
    const ec = getPurchaseAmountSuggestions([{ ...sourceItem, ecPurchaseCandidates: [candidate(5000, true)] }])
    for (const price of nonemptyPrices) {
      const existing = { ...settings, prices: [price] }
      expect(fillSalesQuotePurchaseAmounts(existing, supplier)).toBe(existing)
      expect(fillSalesQuotePurchaseAmounts(existing, ec)).toBe(existing)
      expect(fillSalesQuotePurchaseAmounts(existing, new Map())).toBe(existing)
    }
  })

  it('変更の確認では現在の価格を保ち、送料とマージンを含めた反映後の単価を提示する', () => {
    const price: QuotePrice = { ...blankPrice, purchaseAmount: '4000', purchaseAmountSource: 'manual', shippingFee: '200', margin: '1.5', unitPrice: '8400', taxRate: 8 }
    const suggestion = getPurchaseAmountSuggestions([sourceItem]).get('a')
    expect(getPurchaseAmountUpdate(price, suggestion)).toEqual({ ...price, purchaseAmount: '4200', purchaseAmountSource: 'supplier', unitPrice: '8800' })
    expect(price).toMatchObject({ purchaseAmount: '4000', purchaseAmountSource: 'manual', unitPrice: '8400' })
    expect(getPurchaseAmountUpdate({ ...price, purchaseAmount: '4200' }, suggestion)).toBeUndefined()
  })

  it('出所の記録がない既存版を読み込み、不正な出所は拒否する', () => {
    const price = { ...blankPrice, purchaseAmount: '4000', unitPrice: '5000' }
    expect(parseQuoteSettings({ ...settings, prices: [price] }).prices[0]).toEqual(price)
    expect(() => parseQuoteSettings({ ...settings, prices: [{ ...price, purchaseAmountSource: 'unknown' }] }))
      .toThrow('購入金額の出所が不正です。')
  })
})
