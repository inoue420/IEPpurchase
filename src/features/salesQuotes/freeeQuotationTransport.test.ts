import { describe, expect, it, vi } from 'vitest'
import { freeeResult, updateFreeeQuotation, type FreeeUpdateTarget } from '../../../functions/src/freeeQuotationTransport'
import type { FreeeQuotePayload } from '../../../functions/src/salesQuoteModel'

const payload: FreeeQuotePayload = {
  company_id: 456, partner_id: 123, quotation_date: '2026-10-15', subject: 'Quotation', partner_title: '御中',
  tax_entry_method: 'out', tax_fraction: 'omit', line_amount_fraction: 'omit', withholding_tax_entry_method: 'out',
  quotation_note: '', memo: 'previous', lines: [{ type: 'item', description: 'Bolt', quantity: 1, unit: 'pcs', unit_price: '100', tax_rate: 10, reduced_tax_rate: false, withholding: false }],
}
function quotation(location = '') {
  return { ...payload, id: 99, quotation_number: 'Q-99', total_amount: 110, amount_tax: 10, delivery_location: location,
    template_id: 17, partner_address_zipcode: '100-0001', sending_status: 'unsent', cancel_status: 'uncanceled',
    report_url: 'https://invoice.secure.freee.co.jp/reports/quotations/99' }
}
function target(location = '', legacy = false): FreeeUpdateTarget {
  const result = freeeResult({ quotation: quotation(location) }, payload, 110, 10)
  return { id: 99, number: 'Q-99', payload, total: 110, tax: 10, contentDigest: result.contentDigest,
    ...(!legacy ? { deliveryLocation: result.deliveryLocation } : {}) }
}
const next = { ...payload, delivery_location: 'Bldg. GOJ-706', memo: 'next' }
function http(change: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>(async (_url, init) => new Response(JSON.stringify({ quotation: init?.method === 'PUT'
    ? { ...quotation(), ...next } : { ...quotation(), delivery_location: 'test', ...change } })))
}

describe('explicit delivery location updates with protected freee content', () => {
  it.each([false, true])('replaces only the selected location with one same-ID PUT (legacy=%s)', async legacy => {
    const fetcher = http()
    const result = await updateFreeeQuotation(target('', legacy), next, 'fake', 110, 10, fetcher)
    expect(result).toMatchObject({ id: 99, verification: 'matched', deliveryLocation: next.delivery_location })
    expect(fetcher).toHaveBeenCalledTimes(2)
    const [url, init] = fetcher.mock.calls[1]
    expect(url).toBe('https://api.freee.co.jp/iv/quotations/99')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toMatchObject({ ...next, template_id: 17, partner_address_zipcode: '100-0001' })
  })
  it.each([
    { subject: 'Manual subject' }, { quotation_note: 'Manual note' }, { memo: 'Manual memo' },
    { template_id: 999 }, { partner_address_zipcode: '999-9999' }, { lines: [] }, { sending_status: 'sent' }, { cancel_status: 'canceled' },
  ])('blocks other changes before any write: %j', async change => {
    const fetcher = http(change)
    await expect(updateFreeeQuotation(target('', true), next, 'fake', 110, 10, fetcher)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined()
  })
  it('protects the external location when the RFQ has no selected replacement', async () => {
    const fetcher = http()
    await expect(updateFreeeQuotation(target('', true), { ...payload, memo: 'next' }, 'fake', 110, 10, fetcher)).rejects.toThrow('手修正')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('requires the original digest and never guesses an unknown legacy template location', async () => {
    for (const original of [{ ...target(), payload: { ...payload, delivery_location: 'Original location' }, contentDigest: undefined }, target('Unknown template location', true)]) {
      const fetcher = http({ template_id: 999 })
      await expect(updateFreeeQuotation(original, next, 'fake', 110, 10, fetcher)).rejects.toThrow('手修正')
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
    const fetcher = http()
    await expect(updateFreeeQuotation(target('Unknown template location', true), next, 'fake', 110, 10, fetcher)).rejects.toThrow('手修正')
  })
  it('uses the stored original location to protect other fields of a template quotation', async () => {
    const fetcher = http()
    expect((await updateFreeeQuotation(target('Original template location'), next, 'fake', 110, 10, fetcher)).verification).toBe('matched')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
