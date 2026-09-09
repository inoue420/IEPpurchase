import { describe, expect, it } from 'vitest'
import { MAX_ATTACHMENT_SIZE, validateAttachmentFile } from './documentValidation'

describe('supplier quote attachment validation', () => {
  it.each([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ])('accepts %s', type => {
    expect(() => validateAttachmentFile({ size: MAX_ATTACHMENT_SIZE, type })).not.toThrow()
  })

  it('rejects empty, oversized and unsupported files', () => {
    expect(() => validateAttachmentFile({ size: 0, type: 'application/pdf' })).toThrow('空のファイル')
    expect(() => validateAttachmentFile({ size: MAX_ATTACHMENT_SIZE + 1, type: 'application/pdf' })).toThrow('10MB以下')
    expect(() => validateAttachmentFile({ size: 1, type: 'text/plain' })).toThrow('PDF、画像、Excel')
  })
})
