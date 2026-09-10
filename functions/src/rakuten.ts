import { defineSecret, defineString } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

const applicationId = defineSecret('RAKUTEN_APPLICATION_ID')
const accessKey = defineSecret('RAKUTEN_ACCESS_KEY')
const siteUrl = defineString('RAKUTEN_SITE_URL', { default: '', description: '楽天アプリに登録した許可WebサイトURL' })
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const flag = (value: unknown): number | null => value === 0 || value === 1 ? value : null
export function parseRakutenItems(body: unknown) {
  const data = record(body)
  const values = data.Items ?? data.items
  if (!Array.isArray(values)) throw new HttpsError('unavailable', '楽天の検索結果を読み取れませんでした。')
  return values.flatMap(value => {
    const item = record(value)
    if (typeof item.itemCode !== 'string' || !item.itemCode || item.itemCode.length > 200 || typeof item.itemName !== 'string' || !item.itemName || item.itemName.length > 500 || typeof item.shopName !== 'string' || item.shopName.length > 200 || typeof item.itemPrice !== 'number' || !Number.isSafeInteger(item.itemPrice) || item.itemPrice < 0 || item.itemPrice > 1_000_000_000 || typeof item.itemUrl !== 'string') return []
    try { const url = new URL(item.itemUrl); if (url.protocol !== 'https:' || !(url.hostname === 'rakuten.co.jp' || url.hostname.endsWith('.rakuten.co.jp')) || url.username || url.password) return [] } catch { return [] }
    return [{ itemCode: item.itemCode, itemName: item.itemName, itemPrice: item.itemPrice, itemUrl: item.itemUrl, shopName: item.shopName, taxFlag: flag(item.taxFlag), postageFlag: flag(item.postageFlag), availability: flag(item.availability) }]
  })
}
export function parseRakutenKeyword(data: unknown): string {
  const keyword = record(data).keyword
  if (typeof keyword !== 'string' || !keyword.trim() || Buffer.byteLength(keyword.trim(), 'utf8') > 128) throw new HttpsError('invalid-argument', '検索語を128バイト以内で入力してください。')
  return keyword.trim()
}
export async function fetchRakutenItems(keyword: string, appId: string, key: string, fetcher: typeof fetch = fetch, website = '') {
  if (!appId || !key) throw new HttpsError('failed-precondition', '楽天の認証設定を確認してください。')
  let origin: string
  try { const site = new URL(website); if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password) throw new Error(); origin = site.origin } catch { throw new HttpsError('failed-precondition', '楽天の許可WebサイトURLを設定してください。') }
  const url = new URL('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701')
  url.search = new URLSearchParams({ applicationId: appId, keyword, format: 'json', formatVersion: '2', hits: '20', page: '1', availability: '0' }).toString()
  try {
    const response = await fetcher(url, { headers: { accessKey: key, Referer: website, Origin: origin }, signal: AbortSignal.timeout(15000), redirect: 'error' })
    if (response.status === 404) return { items: [], retrievedAt: new Date().toISOString() }
    if (response.status === 429) throw new HttpsError('resource-exhausted', '楽天の検索制限に達しました。しばらく待って再検索してください。')
    if ([400, 401, 403].includes(response.status)) throw new HttpsError('failed-precondition', '楽天検索が拒否されました。検索語と楽天側の認証・許可設定を確認してください。')
    if (!response.ok) throw new HttpsError('unavailable', '楽天検索を利用できません。時間をおいて再検索してください。')
    return { items: parseRakutenItems(await response.json()), retrievedAt: new Date().toISOString() }
  } catch (error) {
    // Never expose upstream response bodies, request URLs or credentials.
    if (error instanceof HttpsError) throw error
    throw new HttpsError('unavailable', '楽天検索に接続できませんでした。時間をおいて再検索してください。')
  }
}
export const searchRakutenItems = onCall({ region: 'asia-northeast1', invoker: 'public', secrets: [applicationId, accessKey], timeoutSeconds: 30, maxInstances: 1, concurrency: 1 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  const keyword = parseRakutenKeyword(request.data)
  return fetchRakutenItems(keyword, applicationId.value(), accessKey.value(), fetch, siteUrl.value())
})
