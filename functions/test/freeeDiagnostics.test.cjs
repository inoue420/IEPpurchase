const { test } = require('node:test')
const assert = require('node:assert/strict')
const { safeOAuthDescription } = require('../lib/freeeDiagnostics')

test('OAuth diagnostics redact credentials, encoded values, URLs and token-like values', () => {
  const secret = 'private+secret/value'
  const result = safeOAuthDescription(`invalid ${secret} ${encodeURIComponent(secret)} https://example.com/?code=abc abcdefghijklmnopqrstuvwxyz0123456789`, [secret])
  assert.ok(!result.includes(secret))
  assert.ok(!result.includes(encodeURIComponent(secret)))
  assert.ok(!result.includes('https://'))
  assert.ok(!result.includes('abcdefghijklmnopqrstuvwxyz0123456789'))
})
test('OAuth diagnostics preserve explanatory text and handle missing descriptions', () => {
  assert.equal(safeOAuthDescription('リダイレクトURIが異なります。', []), 'リダイレクトURIが異なります。')
  assert.equal(safeOAuthDescription(undefined, []), 'unavailable')
  assert.ok(safeOAuthDescription('文'.repeat(1000), []).length <= 600)
})
