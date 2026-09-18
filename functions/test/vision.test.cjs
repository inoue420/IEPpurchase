const { test } = require('node:test')
const assert = require('node:assert/strict')
const { extractVisionText, extractVisionOcrText } = require('../lib/vision.js')

test('rejects unauthenticated OCR calls', async () => {
  await assert.rejects(extractVisionOcrText.run({ data: {} }), { code: 'unauthenticated' })
})

test('extracts image document text and confidence', async () => {
  const result = await extractVisionText({ mimeType: 'image/png', contentBase64: 'YQ==' }, 'key', async (url, init) => {
    assert.equal(url.pathname, '/v1/images:annotate')
    assert.equal(url.searchParams.get('key'), 'key')
    assert.equal(JSON.parse(init.body).requests[0].features[0].type, 'DOCUMENT_TEXT_DETECTION')
    return new Response(JSON.stringify({ responses: [{ fullTextAnnotation: { text: 'A-100 2 本', pages: [{ confidence: 0.8 }] } }] }))
  })
  assert.deepEqual(result, { text: 'A-100 2 本', confidence: 0.8, pageCount: 1 })
})

test('flattens synchronous PDF page responses', async () => {
  const result = await extractVisionText({ mimeType: 'application/pdf', contentBase64: 'YQ==' }, 'key', async (url, init) => {
    assert.equal(url.pathname, '/v1/files:annotate')
    assert.deepEqual(JSON.parse(init.body).requests[0].pages, [1, 2, 3, 4, 5])
    return new Response(JSON.stringify({ responses: [{ responses: [
      { fullTextAnnotation: { text: 'page 1', pages: [{ confidence: 0.9 }] } },
      { fullTextAnnotation: { text: 'page 2', pages: [{ confidence: 0.7 }] } },
    ] }] }))
  })
  assert.deepEqual(result, { text: 'page 1\npage 2', confidence: 0.8, pageCount: 2 })
})
