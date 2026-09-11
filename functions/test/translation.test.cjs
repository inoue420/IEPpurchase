const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseTranslationRequest, googleTranslate, azureTranslate, translateGoogleText } = require('../lib/translation.js')
test('rejects unauthenticated calls and invalid input before external requests', async () => {
  await assert.rejects(translateGoogleText.run({ data: { text: 'bolt' } }), { code: 'unauthenticated' })
  for (const value of [null, {}, { provider: 'other', text: 'a' }, { provider: 'google', text: ' ' }, { provider: 'azure', text: 'a'.repeat(5001) }]) assert.throws(() => parseTranslationRequest(value), { code: 'invalid-argument' })
  assert.equal(parseTranslationRequest({ provider: 'google', text: ' bolt ' }).text, 'bolt')
})
test('Google translates Japanese plain text into English with automatic source detection', async () => {
  const result = await googleTranslate('ボルト', 'test-key', async (url, init) => {
    assert.equal(url.hostname, 'translation.googleapis.com')
    assert.deepEqual(JSON.parse(init.body), { q: 'ボルト', target: 'en', format: 'text' })
    return new Response(JSON.stringify({ data: { translations: [{ translatedText: 'bolt', detectedSourceLanguage: 'ja' }] } }))
  })
  assert.deepEqual(result, { translatedText: 'bolt', detectedSourceLanguage: 'ja' })
})
test('Azure uses subscription headers and returns the detected language', async () => {
  const result = await azureTranslate('bolt', 'test-key', 'japaneast', 'https://api.cognitive.microsofttranslator.com', async (url, init) => {
    assert.equal(url.pathname, '/translate')
    assert.equal(url.searchParams.get('to'), 'en')
    assert.equal(init.headers['Ocp-Apim-Subscription-Region'], 'japaneast')
    assert.deepEqual(JSON.parse(init.body), [{ Text: 'bolt' }])
    return new Response(JSON.stringify([{ translations: [{ text: 'ボルト' }], detectedLanguage: { language: 'en' } }]))
  })
  assert.equal(result.translatedText, 'ボルト')
  assert.equal(result.detectedSourceLanguage, 'en')
})
test('upstream errors never return the response body or credential', async () => {
  for (const status of [401, 429, 500]) {
    await assert.rejects(googleTranslate('bolt', 'secret', async () => new Response('secret', { status })), error => !error.message.includes('secret'))
  }
  await assert.rejects(googleTranslate('bolt', ''), { code: 'failed-precondition' })
  await assert.rejects(azureTranslate('bolt', 'key', '', 'http://example.com'), { code: 'failed-precondition' })
})
