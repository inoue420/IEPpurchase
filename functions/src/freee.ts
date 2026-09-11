import { createHash, randomBytes } from 'node:crypto'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'

const REGION = 'asia-northeast1'
const AUTHORIZE_URL = 'https://accounts.secure.freee.co.jp/public_api/authorize'
const TOKEN_URL = 'https://accounts.secure.freee.co.jp/public_api/token'
const STATE_TTL_MS = 10 * 60 * 1000
const freeeClientId = defineSecret('FREEE_CLIENT_ID')
const freeeClientSecret = defineSecret('FREEE_CLIENT_SECRET')
const freeeOAuthTokens = defineSecret('FREEE_OAUTH_TOKENS')
const secretManager = new SecretManagerServiceClient()
const db = getFirestore()

interface TokenResponse { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; company_id?: unknown; scope?: unknown }
function projectId(): string { const value = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT; if (!value) throw new Error('Firebase project IDを解決できません。'); return value }
function callbackUrl(): string { return `https://${REGION}-${projectId()}.cloudfunctions.net/freeeOAuthCallback` }
function stateDocumentId(state: string): string { return createHash('sha256').update(state).digest('hex') }
function codeDiagnostics(code: string): { length: number; hasWhitespace: boolean; fingerprint: string } {
  return { length: code.length, hasWhitespace: /\s/.test(code), fingerprint: createHash('sha256').update(code).digest('hex').slice(0, 12) }
}
function page(response: import('express').Response, status: number, title: string, message: string): void { response.status(status).type('html').send(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>${title}</title><body><h1>${title}</h1><p>${message}</p><p>この画面は閉じてIEPpurchaseへ戻れます。</p></body></html>`) }

export const beginFreeeOAuth = onCall({ region: REGION, invoker: 'public', secrets: [freeeClientId] }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  const clientId = freeeClientId.value()
  if (!clientId) throw new HttpsError('failed-precondition', 'freee Client IDが未設定です。')
  const state = randomBytes(32).toString('base64url')
  await db.collection('freeeOAuthStates').doc(stateDocumentId(state)).create({ requestedBy: request.auth.uid, createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS) })
  const authorizationUrl = new URL(AUTHORIZE_URL)
  authorizationUrl.searchParams.set('response_type', 'code'); authorizationUrl.searchParams.set('client_id', clientId); authorizationUrl.searchParams.set('redirect_uri', callbackUrl()); authorizationUrl.searchParams.set('state', state); authorizationUrl.searchParams.set('prompt', 'select_company')
  return { authorizationUrl: authorizationUrl.toString() }
})

async function exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; companyId: string | null; scope: string | null }> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: freeeClientId.value(), client_secret: freeeClientSecret.value(), code, redirect_uri: callbackUrl() })
  const result = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!result.ok) {
    const errorBody = await result.json().catch(() => null) as { error?: unknown } | null
    const errorCode = typeof errorBody?.error === 'string' ? errorBody.error : 'unknown_error'
    throw new Error(`freee token endpoint returned ${result.status} (${errorCode}); code=${JSON.stringify(codeDiagnostics(code))}; redirectUri=${callbackUrl()}`)
  }
  const token = await result.json() as TokenResponse
  if (typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string' || typeof token.expires_in !== 'number') throw new Error('freee token response is invalid')
  return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in, companyId: typeof token.company_id === 'number' || typeof token.company_id === 'string' ? String(token.company_id) : null, scope: typeof token.scope === 'string' ? token.scope : null }
}
async function storeTokens(tokens: Awaited<ReturnType<typeof exchangeCode>>): Promise<void> {
  const payload = JSON.stringify({ ...tokens, authorizedAt: new Date().toISOString(), callbackUrl: callbackUrl() })
  await secretManager.addSecretVersion({ parent: `projects/${projectId()}/secrets/${freeeOAuthTokens.name}`, payload: { data: Buffer.from(payload) } })
}

export const freeeOAuthCallback = onRequest({ region: REGION, invoker: 'public', secrets: [freeeClientId, freeeClientSecret] }, async (request, response) => {
  if (request.method !== 'GET') return page(response, 405, '許可されていない要求です', 'GETリクエストのみ受け付けます。')
  const state = typeof request.query.state === 'string' ? request.query.state : ''
  const code = typeof request.query.code === 'string' ? request.query.code : ''
  const providerError = typeof request.query.error === 'string' ? request.query.error : ''
  if (!state) return page(response, 400, '認可を確認できません', '認可状態が不足しています。IEPpurchaseからやり直してください。')
  const stateRef = db.collection('freeeOAuthStates').doc(stateDocumentId(state)); const stateSnapshot = await stateRef.get()
  if (!stateSnapshot.exists || stateSnapshot.get('expiresAt').toMillis() < Date.now()) { if (stateSnapshot.exists) await stateRef.delete(); return page(response, 400, '認可を確認できません', '認可状態が無効または期限切れです。IEPpurchaseからやり直してください。') }
  await stateRef.delete()
  if (providerError || !code) return page(response, 400, 'freee連携は完了していません', 'freeeで認可が取り消されたか、認可コードを受信できませんでした。')
  try { await storeTokens(await exchangeCode(code)); return page(response, 200, 'freee連携を設定しました', '対象事業所への接続情報を安全に保存しました。見積書の作成・送付はまだ実行していません。') } catch (error) { console.error('freee OAuth callback failed', error); return page(response, 502, 'freee連携を設定できませんでした', 'トークンの取得または安全な保存に失敗しました。IEPpurchaseからもう一度お試しください。') }
})
export const freeeOAuthCallbackUrl = callbackUrl
