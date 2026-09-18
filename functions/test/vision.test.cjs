const { test } = require('node:test')
const assert = require('node:assert/strict')
const { detectTableGrid, extractVisionText, extractVisionOcrText, layoutVisionText } = require('../lib/vision.js')
const word = (text, left, top, right, bottom) => ({
  symbols: [...text].map(character => ({ text: character })),
  boundingBox: { vertices: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }] },
})

test('reassembles split Japanese headers and keeps product text out of manufacturer', () => {
  const annotation = { pages: [{ width: 500, blocks: [{ paragraphs: [{ words: [
    word('メーカー', 60, 10, 105, 24),
    word('製', 270, 10, 281, 24), word('品', 282, 10, 293, 24), word('名', 294, 10, 305, 24),
    word('数', 464, 10, 475, 24), word('量', 476, 10, 487, 24),
    word('7', 20, 40, 27, 54), word('MAKITA', 40, 40, 90, 54),
    word('充電式ドライバー', 138, 40, 290, 54), word('TD173DZ', 306, 40, 369, 54), word('1', 469, 40, 477, 54),
  ] }] }] }] }
  assert.equal(layoutVisionText(annotation), 'メーカー名\t詳細\t数量\nMAKITA\t充電式ドライバー TD173DZ\t1')
})

test('does not construct a misleading two-column table when product header is missing', () => {
  const annotation = { pages: [{ width: 500, blocks: [{ paragraphs: [{ words: [
    word('メーカー', 60, 10, 105, 24), word('数量', 464, 10, 487, 24),
    word('MAKITA', 40, 40, 90, 54), word('TD173DZ', 138, 40, 205, 54), word('1', 469, 40, 477, 54),
  ] }] }] }] }
  assert.equal(layoutVisionText(annotation), '')
})

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

test('uses word coordinates to restore table rows and columns', () => {
  const annotation = { pages: [{ width: 520, blocks: [{ paragraphs: [{ words: [
    word('メーカー', 50, 10, 120, 25), word('製品名', 260, 10, 330, 25), word('数量', 465, 10, 500, 25),
    word('1', 20, 40, 28, 55), word('スプレノン', 50, 40, 120, 55), word('網', 260, 40, 275, 55), word('大型', 280, 40, 310, 55), word('青', 315, 40, 330, 55), word('1', 475, 40, 483, 55),
    word('2', 20, 70, 28, 85), word('MAKITA', 50, 70, 110, 85), word('TD173DZ', 260, 70, 325, 85), word('充電式ドライバー', 330, 70, 440, 85), word('2', 475, 70, 483, 85),
  ] }] }] }] }
  assert.equal(layoutVisionText(annotation), 'メーカー名\t詳細\t数量\nスプレノン\t網 大型 青\t1\nMAKITA\tTD173DZ 充電式ドライバー\t2')
})

test('infers column boundaries from repeated data gaps when centered headers are misleading', () => {
  const annotation = { pages: [{ width: 520, blocks: [{ paragraphs: [{ words: [
    word('メーカー', 60, 10, 125, 25), word('製品名', 275, 10, 335, 25), word('数量', 470, 10, 505, 25),
    word('1', 20, 40, 28, 55), word('スプレノン', 48, 40, 112, 55), word('網大型青', 145, 40, 205, 55), word('1', 480, 40, 488, 55),
    word('2', 20, 70, 28, 85), word('MAKITA', 48, 70, 108, 85), word('TD173DZ', 145, 70, 210, 85), word('充電式ドライバー', 215, 70, 345, 85), word('2', 480, 70, 488, 85),
    word('3', 20, 100, 28, 115), word('Hanchen', 48, 100, 115, 115), word('電動ロータリー', 145, 100, 260, 115), word('1', 480, 100, 488, 115),
  ] }] }] }] }
  assert.equal(layoutVisionText(annotation), 'メーカー名\t詳細\t数量\nスプレノン\t網大型青\t1\nMAKITA\tTD173DZ 充電式ドライバー\t2\nHanchen\t電動ロータリー\t1')
})

test('detects table ruling lines in an image and uses them as column boundaries', async () => {
  const svg = Buffer.from('<svg width="500" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="500" height="120" fill="white"/><g stroke="black" stroke-width="2"><path d="M10 10V110M130 10V110M440 10V110M490 10V110M10 10H490M10 40H490M10 75H490M10 110H490"/></g></svg>')
  const grid = await detectTableGrid(svg)
  assert.ok(grid)
  const annotation = { pages: [{ width: 500, blocks: [{ paragraphs: [{ words: [
    word('メーカー', 60, 15, 120, 30), word('製品名', 250, 15, 310, 30), word('数量', 455, 15, 480, 30),
    word('MAKITA', 45, 48, 110, 65), word('充電式ドライバー', 150, 48, 330, 65), word('1', 460, 48, 470, 65),
  ] }] }] }] }
  assert.equal(layoutVisionText(annotation, grid), 'メーカー名\t詳細\t数量\nMAKITA\t充電式ドライバー\t1')
})
