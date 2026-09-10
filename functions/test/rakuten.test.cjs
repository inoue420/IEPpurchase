const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseRakutenKeyword, parseRakutenItems, fetchRakutenItems, searchRakutenItems } = require('../lib/rakuten.js')
const fetchWithSite = (keyword, appId, key, fetcher) => fetchRakutenItems(keyword, appId, key, fetcher, 'https://ieppurchase.example.test/')
const item = { itemCode: 'shop:123', itemName: 'テスト工具', itemPrice: 1200, itemUrl: 'https://item.rakuten.co.jp/shop/123/', shopName: '店舗', taxFlag: 0, postageFlag: 0, availability: 1 }
test('validates search input before external access', () => {
  assert.equal(parseRakutenKeyword({ keyword: ' 工具 ' }), '工具')
  for (const value of [null, {}, { keyword: '' }, { keyword: 'あ'.repeat(43) }]) assert.throws(() => parseRakutenKeyword(value), { code: 'invalid-argument' })
})
test('normalizes results and rejects unsafe or malformed candidates', () => {
  assert.deepEqual(parseRakutenItems({ Items: [item] }), [item])
  assert.deepEqual(parseRakutenItems({ items: [] }), [])
  assert.deepEqual(parseRakutenItems({ Items: [{ ...item, itemPrice: -1 }, { ...item, itemUrl: 'javascript:alert(1)' }, { ...item, itemUrl: 'https://rakuten.co.jp.evil.example/' }] }), [])
  assert.throws(() => parseRakutenItems({}), { code: 'unavailable' })
})
test('sends secrets server-side and returns a timestamped result', async () => {
  const result = await fetchWithSite('工具', 'dummy-app', 'dummy-key', async (url, options) => {
    assert.equal(url.searchParams.get('keyword'), '工具')
    assert.equal(url.searchParams.get('formatVersion'), '2')
    assert.equal(options.headers.accessKey, 'dummy-key')
    assert.equal(options.headers.Referer, 'https://ieppurchase.example.test/')
    assert.equal(options.headers.Origin, 'https://ieppurchase.example.test')
    assert.equal(url.searchParams.has('accessKey'), false)
    return new Response(JSON.stringify({ Items: [item] }))
  })
  assert.deepEqual(result.items, [item])
  assert.ok(Number.isFinite(Date.parse(result.retrievedAt)))
  assert.ok(!JSON.stringify(result).includes('dummy-key'))
})
test('handles no results and upstream failures without exposing credentials', async () => {
  assert.deepEqual((await fetchWithSite('工具', 'app', 'secret', async () => new Response('', { status: 404 }))).items, [])
  for (const [status, code] of [[429, 'resource-exhausted'], [403, 'failed-precondition'], [500, 'unavailable']]) {
    await assert.rejects(fetchWithSite('工具', 'app', 'secret', async () => new Response('secret', { status })), error => error.code === code && !error.message.includes('secret'))
  }
  await assert.rejects(fetchWithSite('工具', 'app', 'secret', async () => { throw new Error('secret') }), error => error.code === 'unavailable' && !error.message.includes('secret'))
})
test('rejects unauthenticated callable before secret access', async () => {
  await assert.rejects(searchRakutenItems.run({ data: { keyword: '工具' } }), { code: 'unauthenticated' })
})
