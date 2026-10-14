const { test } = require('node:test')
const assert = require('node:assert/strict')
const { HttpsError } = require('firebase-functions/v2/https')
const { parseFreeeAppCredentials, parseRakutenCredentials } = require('../lib/secretCredentials.js')

const freee = { clientId: 'dummy-freee-id', clientSecret: 'dummy-freee-secret' }
const rakuten = { applicationId: 'dummy-rakuten-id', accessKey: 'dummy-rakuten-key' }

function assertConfigurationError(parse, value, forbidden = []) {
  assert.throws(() => parse(value), error => {
    assert.ok(error instanceof HttpsError)
    assert.equal(error.code, 'failed-precondition')
    assert.equal(error.details, undefined)
    for (const credential of forbidden) {
      assert.ok(!error.message.includes(credential))
      assert.ok(!String(error.stack).includes(credential))
      assert.ok(!JSON.stringify(error).includes(credential))
    }
    return true
  })
}

test('reads both fields from one freee credential bundle without altering values', () => {
  const credentials = { clientId: '  dummy-freee-id\n', clientSecret: ' dummy-freee-secret\t' }
  assert.deepEqual(parseFreeeAppCredentials(JSON.stringify(credentials)), credentials)
  assert.deepEqual(parseFreeeAppCredentials(JSON.stringify({ ...freee, description: 'ignored metadata' })), freee)
})

test('reads both fields from one Rakuten credential bundle without altering values', () => {
  const credentials = { applicationId: '\tdummy-rakuten-id ', accessKey: '\ndummy-rakuten-key ' }
  assert.deepEqual(parseRakutenCredentials(JSON.stringify(credentials)), credentials)
  assert.deepEqual(parseRakutenCredentials(JSON.stringify({ ...rakuten, description: 'ignored metadata' })), rakuten)
})

test('rejects invalid JSON and non-object bundles with a safe configuration error', () => {
  for (const parse of [parseFreeeAppCredentials, parseRakutenCredentials]) {
    for (const value of ['', '{', 'null', '[]', '[{}]', '123', 'true', '"dummy-credential"']) {
      assertConfigurationError(parse, value, ['dummy-credential'])
    }
    assertConfigurationError(parse, '{"clientSecret":"dummy-secret-in-broken-json"', ['dummy-secret-in-broken-json'])
  }
})

test('rejects missing, empty, blank and non-string freee fields', () => {
  assertConfigurationError(parseFreeeAppCredentials, '{}')
  for (const field of ['clientId', 'clientSecret']) {
    const missing = { ...freee }
    delete missing[field]
    assertConfigurationError(parseFreeeAppCredentials, JSON.stringify(missing), Object.values(freee))
    for (const value of ['', ' \n\t', null, 123, false, [], {}]) {
      assertConfigurationError(parseFreeeAppCredentials, JSON.stringify({ ...freee, [field]: value }), Object.values(freee))
    }
  }
})

test('rejects missing, empty, blank and non-string Rakuten fields', () => {
  assertConfigurationError(parseRakutenCredentials, '{}')
  for (const field of ['applicationId', 'accessKey']) {
    const missing = { ...rakuten }
    delete missing[field]
    assertConfigurationError(parseRakutenCredentials, JSON.stringify(missing), Object.values(rakuten))
    for (const value of ['', ' \n\t', null, 123, false, [], {}]) {
      assertConfigurationError(parseRakutenCredentials, JSON.stringify({ ...rakuten, [field]: value }), Object.values(rakuten))
    }
  }
})

test('does not accept another provider or combine incomplete credentials', () => {
  assertConfigurationError(parseFreeeAppCredentials, JSON.stringify(rakuten), Object.values(rakuten))
  assertConfigurationError(parseRakutenCredentials, JSON.stringify(freee), Object.values(freee))
  assertConfigurationError(parseFreeeAppCredentials, JSON.stringify({ clientId: freee.clientId, accessKey: rakuten.accessKey }), [freee.clientId, rakuten.accessKey])
  assertConfigurationError(parseRakutenCredentials, JSON.stringify({ applicationId: rakuten.applicationId, clientSecret: freee.clientSecret }), [rakuten.applicationId, freee.clientSecret])
  assertConfigurationError(parseFreeeAppCredentials, JSON.stringify([{ clientId: freee.clientId }, { clientSecret: freee.clientSecret }]), Object.values(freee))
  assertConfigurationError(parseRakutenCredentials, JSON.stringify([{ applicationId: rakuten.applicationId }, { accessKey: rakuten.accessKey }]), Object.values(rakuten))
})
