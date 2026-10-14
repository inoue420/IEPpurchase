const { test } = require('node:test')
const assert = require('node:assert/strict')
const { initializeApp } = require('firebase-admin/app')
initializeApp({ projectId: 'demo-ieppurchase-secret-bindings' })
const { getFreeeConnectionStatus, beginFreeeOAuth, freeeOAuthCallback } = require('../lib/freee.js')
const quotes = require('../lib/freeeQuotation.js')
const { searchRakutenItems } = require('../lib/rakuten.js')

test('deployment manifest explicitly clears every old OAuth token binding', () => {
  for (const call of [getFreeeConnectionStatus, quotes.searchFreeePartners, quotes.saveSalesQuotePricing, quotes.sendFreeeQuotation, quotes.reconcileFreeeQuotation]) {
    assert.ok(Object.hasOwn(call.__endpoint, 'secretEnvironmentVariables'))
    assert.deepEqual(call.__endpoint.secretEnvironmentVariables, [])
  }
})
test('deployment manifest binds only the respective combined credentials', () => {
  for (const call of [beginFreeeOAuth, freeeOAuthCallback]) {
    assert.deepEqual(call.__endpoint.secretEnvironmentVariables.map(value => value.key), ['FREEE_APP_CREDENTIALS'])
  }
  assert.deepEqual(searchRakutenItems.__endpoint.secretEnvironmentVariables.map(value => value.key), ['RAKUTEN_CREDENTIALS'])
})
