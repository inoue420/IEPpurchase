import { defineSecret, defineString } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

const REGION = 'asia-northeast1'
const googleApiKey = defineSecret('GOOGLE_TRANSLATE_API_KEY')
const azureApiKey = defineSecret('AZURE_TRANSLATOR_KEY')
const azureRegion = defineString('AZURE_TRANSLATOR_REGION', { default: '', description: 'Azure AI Translator リソースのリージョン（グローバルリソースでは空欄）' })
const azureEndpoint = defineString('AZURE_TRANSLATOR_ENDPOINT', { default: 'https://api.cognitive.microsofttranslator.com', description: 'Azure AI Translator リソースのHTTPSエンドポイント' })

export type TranslationProvider = 'google' | 'azure'
interface TranslationRequest { provider: TranslationProvider; text: string }
interface TranslationResult { translatedText: string; detectedSourceLanguage: string | null }
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function parseTranslationRequest(value: unknown): TranslationRequest {
  const data = record(value)
  if (data.provider !== 'google' && data.provider !== 'azure') throw new HttpsError('invalid-argument', '翻訳サービスを選択してください。')
  if (typeof data.text !== 'string' || !data.text.trim() || data.text.trim().length > 5000) throw new HttpsError('invalid-argument', '翻訳する原文は1〜5000文字で入力してください。')
  return { provider: data.provider, text: data.text.trim() }
}

function parseTranslationText(value: unknown): string {
  const text = record(value).text
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 5000) throw new HttpsError('invalid-argument', '翻訳する原文は1〜5000文字で入力してください。')
  return text.trim()
}

function endpoint(value: string): URL {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'api.cognitive.microsofttranslator.com' || url.hostname.endsWith('.cognitiveservices.azure.com'))) throw new Error()
    if (url.hostname.endsWith('.cognitiveservices.azure.com') && url.pathname === '/') url.pathname = '/translator/text/v3.0'
    return url
  } catch { throw new HttpsError('failed-precondition', 'Azure Translatorのエンドポイント設定を確認してください。') }
}

async function readResponse(response: Response): Promise<unknown> {
  try { return await response.json() } catch { throw new HttpsError('unavailable', '翻訳サービスの応答を読み取れませんでした。') }
}

export async function googleTranslate(text: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<TranslationResult> {
  if (!apiKey) throw new HttpsError('failed-precondition', 'Google Translationの認証設定を確認してください。')
  const url = new URL('https://translation.googleapis.com/language/translate/v2'); url.searchParams.set('key', apiKey)
  let response: Response
  try { response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text, target: 'en', format: 'text' }), signal: AbortSignal.timeout(15000), redirect: 'error' }) } catch { throw new HttpsError('unavailable', 'Google Translationに接続できませんでした。時間をおいて再試行してください。') }
  if ([400, 401, 403].includes(response.status)) throw new HttpsError('failed-precondition', 'Google Translationの認証または利用設定を確認してください。')
  if (response.status === 429) throw new HttpsError('resource-exhausted', 'Google Translationの利用上限に達しました。')
  if (!response.ok) throw new HttpsError('unavailable', 'Google Translationを利用できません。時間をおいて再試行してください。')
  const body = record(await readResponse(response)); const translations = record(body.data).translations; const result = Array.isArray(translations) ? record(translations[0]) : {}
  if (typeof result.translatedText !== 'string' || !result.translatedText.trim()) throw new HttpsError('unavailable', 'Google Translationの応答を読み取れませんでした。')
  return { translatedText: result.translatedText.trim(), detectedSourceLanguage: typeof result.detectedSourceLanguage === 'string' ? result.detectedSourceLanguage : null }
}

export async function azureTranslate(text: string, apiKey: string, region: string, configuredEndpoint: string, fetcher: typeof fetch = fetch): Promise<TranslationResult> {
  if (!apiKey) throw new HttpsError('failed-precondition', 'Azure Translatorの認証設定を確認してください。')
  const url = endpoint(configuredEndpoint); url.pathname = `${url.pathname.replace(/\/$/, '')}/translate`; url.search = new URLSearchParams({ 'api-version': '3.0', to: 'en' }).toString()
  const headers: Record<string, string> = { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': apiKey }; if (region.trim()) headers['Ocp-Apim-Subscription-Region'] = region.trim()
  let response: Response
  try { response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify([{ Text: text }]), signal: AbortSignal.timeout(15000), redirect: 'error' }) } catch { throw new HttpsError('unavailable', 'Azure Translatorに接続できませんでした。時間をおいて再試行してください。') }
  if ([400, 401, 403].includes(response.status)) throw new HttpsError('failed-precondition', 'Azure Translatorの認証、リージョン、利用設定を確認してください。')
  if (response.status === 429) throw new HttpsError('resource-exhausted', 'Azure Translatorの利用上限に達しました。')
  if (!response.ok) throw new HttpsError('unavailable', 'Azure Translatorを利用できません。時間をおいて再試行してください。')
  const body = await readResponse(response); const result = Array.isArray(body) ? record(body[0]) : {}; const translations = result.translations; const translated = Array.isArray(translations) ? record(translations[0]) : {}
  if (typeof translated.text !== 'string' || !translated.text.trim()) throw new HttpsError('unavailable', 'Azure Translatorの応答を読み取れませんでした。')
  const detectedLanguage = record(result.detectedLanguage)
  return { translatedText: translated.text.trim(), detectedSourceLanguage: typeof detectedLanguage.language === 'string' ? detectedLanguage.language : null }
}

export const translateGoogleText = onCall({ region: REGION, invoker: 'public', secrets: [googleApiKey], timeoutSeconds: 30, maxInstances: 1, concurrency: 5 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  return { provider: 'google', ...(await googleTranslate(parseTranslationText(request.data), googleApiKey.value())) }
})

export const translateAzureText = onCall({ region: REGION, invoker: 'public', secrets: [azureApiKey], timeoutSeconds: 30, maxInstances: 1, concurrency: 5 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  return { provider: 'azure', ...(await azureTranslate(parseTranslationText(request.data), azureApiKey.value(), azureRegion.value(), azureEndpoint.value())) }
})
