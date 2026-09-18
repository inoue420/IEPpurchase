import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

const REGION = 'asia-northeast1'
const visionApiKey = defineSecret('GOOGLE_CLOUD_VISION_API_KEY')
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_TEXT_LENGTH = 50_000
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/x-icon'])
interface VisionRequest { mimeType: string; contentBase64: string }
export interface VisionResult { text: string; confidence: number | null; pageCount: number }
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function requestData(value: unknown): VisionRequest {
  const data = record(value)
  if (typeof data.mimeType !== 'string' || (!imageTypes.has(data.mimeType) && data.mimeType !== 'application/pdf')) throw new HttpsError('invalid-argument', 'JPEG、PNG、GIF、WebP、BMP、ICO、PDFのいずれかを選択してください。')
  if (typeof data.contentBase64 !== 'string' || !data.contentBase64 || data.contentBase64.length > Math.ceil(MAX_FILE_SIZE * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.contentBase64)) throw new HttpsError('invalid-argument', 'ファイル内容が不正です。')
  const byteLength = Buffer.byteLength(data.contentBase64, 'base64')
  if (byteLength <= 0 || byteLength > MAX_FILE_SIZE) throw new HttpsError('invalid-argument', 'ファイルは10MB以下にしてください。')
  return { mimeType: data.mimeType, contentBase64: data.contentBase64 }
}
function confidences(value: unknown): number[] {
  const node = record(value); const current = typeof node.confidence === 'number' && Number.isFinite(node.confidence) ? [node.confidence] : []
  const children = ['pages', 'blocks', 'paragraphs', 'words', 'symbols'].flatMap(key => Array.isArray(node[key]) ? node[key] : [])
  return [...current, ...children.flatMap(confidences)]
}
async function callVision(path: string, body: unknown, apiKey: string, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!apiKey) throw new HttpsError('failed-precondition', 'Google Cloud Visionの認証設定を確認してください。')
  const url = new URL(`https://vision.googleapis.com/v1/${path}`); url.searchParams.set('key', apiKey)
  let response: Response
  try { response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), redirect: 'error' }) } catch { throw new HttpsError('unavailable', 'Google Cloud Visionに接続できませんでした。時間をおいて再試行してください。') }
  if ([400, 401, 403].includes(response.status)) throw new HttpsError('failed-precondition', 'Google Cloud Vision APIの有効化、認証、利用設定を確認してください。')
  if (response.status === 429) throw new HttpsError('resource-exhausted', 'Google Cloud Visionの利用上限に達しました。')
  if (!response.ok) throw new HttpsError('unavailable', 'Google Cloud Visionを利用できません。時間をおいて再試行してください。')
  try { return record(await response.json()) } catch { throw new HttpsError('unavailable', 'Google Cloud Visionの応答を読み取れませんでした。') }
}
export async function extractVisionText(input: VisionRequest, apiKey: string, fetcher: typeof fetch = fetch): Promise<VisionResult> {
  const feature = { type: 'DOCUMENT_TEXT_DETECTION' }
  const body = input.mimeType === 'application/pdf' ? { requests: [{ inputConfig: { content: input.contentBase64, mimeType: input.mimeType }, features: [feature], pages: Array.from({ length: 5 }, (_, index) => index + 1) }] } : { requests: [{ image: { content: input.contentBase64 }, features: [feature] }] }
  const result = await callVision(input.mimeType === 'application/pdf' ? 'files:annotate' : 'images:annotate', body, apiKey, fetcher)
  const outerResponses = Array.isArray(result.responses) ? result.responses.map(record) : []
  const responses = input.mimeType === 'application/pdf'
    ? outerResponses.flatMap(response => Array.isArray(response.responses) ? response.responses.map(record) : [])
    : outerResponses
  if (outerResponses.some(response => record(response.error).message)) throw new HttpsError('failed-precondition', 'OCRできませんでした。PDFのページ数、形式、暗号化状態を確認してください。')
  if (responses.some(response => record(response.error).message)) throw new HttpsError('failed-precondition', 'OCRできませんでした。画像の向き、鮮明さ、PDFのページ数を確認してください。')
  const text = responses.map(response => { const annotation = record(response.fullTextAnnotation); return typeof annotation.text === 'string' ? annotation.text : '' }).filter(Boolean).join('\n').trim()
  if (!text) throw new HttpsError('failed-precondition', '文字を抽出できませんでした。画像を鮮明にして再試行してください。')
  const values = responses.flatMap(response => confidences(response.fullTextAnnotation)).filter(value => value >= 0 && value <= 1)
  return { text: text.slice(0, MAX_TEXT_LENGTH), confidence: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, pageCount: responses.length }
}
export const extractVisionOcrText = onCall({ region: REGION, invoker: 'public', secrets: [visionApiKey], timeoutSeconds: 90, maxInstances: 1, concurrency: 2 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  return extractVisionText(requestData(request.data), visionApiKey.value())
})
