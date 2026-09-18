import { describe, expect, it } from 'vitest'
import type { BulkRfqItemDraft } from './bulkRfqItemParser'
import { applyVisionOcrBatchEdit } from './visionOcrBatchEdit'

const row = (input: Partial<BulkRfqItemDraft['input']>): BulkRfqItemDraft => ({
  rowNumber: 2,
  input: {
    originalDescription: '大型 青', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: 'スプレノン',
    partNumber: '', productName: '', quantity: 1, supplierResponseUnitPrice: null, unit: '個',
    supplierQuoteRequestEnabled: true, marketplaceOfferEnabled: true, ecPurchaseCandidates: [], requestedDeliveryDate: '', status: 'pending', note: '', ...input,
  },
  error: null,
})

describe('applyVisionOcrBatchEdit', () => {
  it('copies description into part number without changing the source', () => {
    const result = applyVisionOcrBatchEdit([row({})], [2], 'copy', 'originalDescription', 'partNumber', 'selected')
    expect(result.rows[0].input).toMatchObject({ originalDescription: '大型 青', partNumber: '大型 青' })
  })

  it('moves description into part number and retains the validation result', () => {
    const result = applyVisionOcrBatchEdit([row({})], [2], 'move', 'originalDescription', 'partNumber', 'selected')
    expect(result.rows[0].input).toMatchObject({ originalDescription: '', partNumber: '大型 青' })
    expect(result.rows[0].error).toBeTruthy()
    expect(result.selectedRowNumbers).toEqual([])
  })

  it('clears a column on every candidate row', () => {
    const second = row({})
    second.rowNumber = 3
    const result = applyVisionOcrBatchEdit([row({}), second], [2], 'clear', 'manufacturerName', null, 'all')
    expect(result.affectedCount).toBe(2)
    expect(result.rows.map(item => item.input.manufacturerName)).toEqual(['', ''])
  })
})
