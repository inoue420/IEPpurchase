import { parsePartner, readFreeePartners } from './freeePartners'
import { createHash } from 'node:crypto'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { hasUnsupportedFreeeDescription, buildQuotePreview, parseQuoteSettings, record, toFreeePayload, type ConfirmedLine, type QuotePreview, type FreeeQuotePayload } from './salesQuoteModel'
import { createFreeeQuotation, FreeeRequestError, freeeResult, type FreeeResult } from './freeeQuotationTransport'

const tokensSecret = defineSecret('FREEE_OAUTH_TOKENS')
const options = { region: 'asia-northeast1', invoker: 'public' as const, secrets: [tokensSecret], timeoutSeconds: 60 }
const manager = new SecretManagerServiceClient()
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpsError('invalid-argument', 'IDが不正です。')
  return value
}
function input(value: unknown): Record<string, unknown> {
  try { return record(value) } catch { throw new HttpsError('invalid-argument', '入力形式が不正です。') }
}
async function connection(requireValidToken: boolean): Promise<{ companyId: number; accessToken: string }> {
  // Read latest explicitly: a deployed secret binding would keep an old OAuth version.
  try {
    const project = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT
    const [version] = await manager.accessSecretVersion({ name: `projects/${project}/secrets/${tokensSecret.name}/versions/latest` })
    const token = record(JSON.parse(Buffer.from(version.payload?.data as Uint8Array).toString('utf8')))
    const companyId = Number(token.companyId)
    if (!Number.isSafeInteger(companyId) || companyId <= 0 || typeof token.accessToken !== 'string' || !token.accessToken) throw new Error('invalid token')
    const expiresAt = typeof token.authorizedAt === 'string' && typeof token.expiresIn === 'number' ? Date.parse(token.authorizedAt) + token.expiresIn * 1000 : 0
    if (requireValidToken && (!Number.isFinite(expiresAt) || expiresAt < Date.now() + 60_000)) throw new Error('expired token')
    return { companyId, accessToken: token.accessToken }
  } catch { throw new HttpsError('failed-precondition', 'freeeの接続情報が未設定・期限切れ、または読み取り不可です。「freee連携」で再認可してください。') }
}
interface ExportRecord {
  partnerName?: string
  rfqId: string; revision: number; status: 'draft' | 'sending' | 'failed' | 'uncertain' | 'sent'
  preview: QuotePreview; companyId: number; customerName: string; customerId: string
  digest: string; marker: string; payload: FreeeQuotePayload; attempt: number
  result: FreeeResult | null; error: string; startedAt?: Timestamp
}
function exportRef(rfqId: string) { return getFirestore().doc(`salesQuotes/${rfqId}/freeeExports/current`) }
function mutable(status: ExportRecord['status']) { return status === 'draft' || status === 'failed' }
function eventData(userId: string, action: string, revision: number, values: Record<string, unknown> = {}) {
  return { action, revision, userId, createdAt: FieldValue.serverTimestamp(), ...values }
}

export const searchFreeePartners = onCall(options, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  const data = input(request.data), keyword = data.keyword ?? '', offset = data.offset ?? 0
  if (typeof keyword !== 'string' || keyword.length > 255 || !Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > 1_000_000) throw new HttpsError('invalid-argument', '検索条件が不正です。')
  const { companyId, accessToken } = await connection(true)
  const params = new URLSearchParams({ company_id: String(companyId), keyword: keyword.trim(), offset: String(offset), limit: '50' })
  const body = await readFreeePartners('?' + params, accessToken)
  if (!Array.isArray(body.partners)) throw new HttpsError('unavailable', 'freee取引先の応答を確認できません。再検索してください。')
  const partners = body.partners.filter(p => record(p).available !== false).map(parsePartner)
  return { companyId, partners, nextOffset: body.partners.length === 50 ? Number(offset) + 50 : null }
})

export const saveSalesQuotePricing = onCall(options, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  const data = input(request.data), rfqId = id(data.rfqId), expectedRevision = data.expectedRevision
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0) throw new HttpsError('invalid-argument', '保存版番号が不正です。')
  let settings
  try { settings = parseQuoteSettings(data.settings) } catch (error) { throw new HttpsError('invalid-argument', (error as Error).message) }
  const { companyId, accessToken } = await connection(data.partnerCompanyId !== undefined)
  let partnerName: string | undefined
  // Legacy clients retain their save format. The picker supplies its searched company.
  if (data.partnerCompanyId !== undefined) {
    if (data.partnerCompanyId !== companyId) throw new HttpsError('failed-precondition', '接続事業所が変わりました。freee取引先を検索し直してください。')
    const body = await readFreeePartners('/' + Number(settings.partnerId) + '?company_id=' + companyId, accessToken)
    const partner = parsePartner(body.partner)
    if (partner.id !== Number(settings.partnerId)) throw new HttpsError('failed-precondition', 'freee取引先が一致しません。選び直してください。')
    partnerName = partner.name
  }
  const db = getFirestore(), ref = exportRef(rfqId), userId = request.auth.uid
  return db.runTransaction(async transaction => {
    const [rfq, quote, items, current] = await Promise.all([
      transaction.get(db.doc(`rfqs/${rfqId}`)), transaction.get(db.doc(`salesQuotes/${rfqId}`)),
      transaction.get(db.collection(`salesQuotes/${rfqId}/items`)), transaction.get(ref),
    ])
    if (!rfq.exists || rfq.get('status') === 'cancelled' || quote.get('status') !== 'confirmed' || items.empty) throw new HttpsError('failed-precondition', '有効なRFQと確定済みの翻訳明細が必要です。')
    const previous = current.data() as ExportRecord | undefined
    if ((previous?.revision ?? 0) !== expectedRevision) throw new HttpsError('aborted', '別の利用者が更新しました。保存済みの内容を読み直してください。')
    if (previous && !mutable(previous.status)) throw new HttpsError('failed-precondition', '送信開始後の販売見積は変更できません。')
    const source: ConfirmedLine[] = items.docs.map(item => {
      const d = item.data()
      if (d.rfqId !== rfqId || d.rfqItemId !== item.id || !(d.confirmedAt instanceof Timestamp)) throw new HttpsError('failed-precondition', '未確定または不整合な翻訳明細があります。')
      return { rfqItemId: item.id, lineNo: d.lineNo, partNumber: d.partNumber, quantity: d.quantity, unit: d.unit,
        originalDescription: d.originalDescription, translatedDescription: d.translatedDescription, outputDescription: d.outputDescription }
    })
    let preview: QuotePreview
    try { preview = buildQuotePreview(settings, source) } catch (error) { throw new HttpsError('failed-precondition', (error as Error).message) }
    const revision = (previous?.revision ?? 0) + 1
    const marker = `IEPpurchase:${rfqId}:v${revision}`
    const payload = toFreeePayload(preview, companyId, marker)
    const saved: ExportRecord = { rfqId, revision, status: 'draft', companyId, ...(partnerName ? { partnerName } : {}),
      customerId: rfq.get('customerId'), customerName: rfq.get('customerName'),
      preview, marker, payload, digest: hash({ payload, preview }), attempt: previous?.attempt ?? 0, result: null, error: '' }
    if (Buffer.byteLength(JSON.stringify(saved), 'utf8') > 750_000) throw new HttpsError('invalid-argument', '保存する原文・翻訳文が大きすぎます。見積を分けてください。')
    transaction.set(ref, { ...saved, createdAt: current.get('createdAt') ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: userId })
    transaction.create(ref.collection('revisions').doc(String(revision)), { ...saved, ...eventData(userId, 'saved', revision) })
    transaction.create(ref.collection('events').doc(), eventData(userId, 'saved', revision))
    return saved
  })
})

export const sendFreeeQuotation = onCall(options, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  const data = input(request.data), rfqId = id(data.rfqId)
  if (data.confirm !== true || typeof data.digest !== 'string') throw new HttpsError('invalid-argument', '送信プレビューの明示確認が必要です。')
  const ref = exportRef(rfqId), db = getFirestore(), userId = request.auth.uid
  const token = await connection(true)
  const claimed = await db.runTransaction(async transaction => {
    const [current, rfq] = await Promise.all([transaction.get(ref), transaction.get(db.doc(`rfqs/${rfqId}`))])
    const saved = current.data() as ExportRecord | undefined
    if (!saved || saved.digest !== data.digest || saved.revision !== data.revision) throw new HttpsError('aborted', '保存版が変更されました。最新のプレビューを確認してください。')
    if (saved.status === 'sent') return { saved, alreadySent: true }
    if (!mutable(saved.status)) throw new HttpsError('failed-precondition', '送信中または結果不明のため再作成できません。作成済み見積書IDを照合してください。')
    if (token.companyId !== saved.companyId) throw new HttpsError('failed-precondition', '接続事業所が変わっています。プレビューを保存し直してください。')
    if (!rfq.exists || rfq.get('status') === 'cancelled' || rfq.get('customerId') !== saved.customerId) throw new HttpsError('failed-precondition', 'RFQの状態または顧客が変更されました。')
    if (saved.payload.lines.some(line => hasUnsupportedFreeeDescription(line.description))) throw new HttpsError('failed-precondition', '保存済みの摘要に改行・制御文字が含まれています。「販売見積を保存」で新しい版を作成し、内容を確認してください。')
    transaction.update(ref, { status: 'sending', attempt: saved.attempt + 1, startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), error: '' })
    transaction.create(ref.collection('events').doc(), eventData(userId, 'sending', saved.revision, { attempt: saved.attempt + 1, digest: saved.digest }))
    return { saved, alreadySent: false }
  })
  if (claimed.alreadySent) return { status: 'sent', result: claimed.saved.result }
  const saved = claimed.saved
  let result: FreeeResult
  try { result = await createFreeeQuotation(saved.payload, token.accessToken, saved.preview.total, saved.preview.tax) }
  catch (error) {
    const known = error instanceof FreeeRequestError
    const status = known && error.retryable ? 'failed' : 'uncertain'
    const message = known ? error.message : '登録結果が不明です。freeeで作成結果を確認してください。'
    const batch = db.batch()
    batch.update(ref, { status, error: message, updatedAt: FieldValue.serverTimestamp() })
    batch.create(ref.collection('events').doc(), eventData(userId, status, saved.revision, { message }))
    await batch.commit()
    return { status, result: null, error: message }
  }
  // If this commit fails, status stays sending. Never perform a second POST.
  const batch = db.batch()
  batch.update(ref, { status: 'sent', result, error: '', updatedAt: FieldValue.serverTimestamp() })
  batch.create(ref.collection('events').doc(), eventData(userId, 'sent', saved.revision, { result }))
  await batch.commit()
  return { status: 'sent', result }
})

export const reconcileFreeeQuotation = onCall(options, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  const data = input(request.data), rfqId = id(data.rfqId)
  if (!Number.isSafeInteger(data.quotationId) || Number(data.quotationId) <= 0) throw new HttpsError('invalid-argument', '作成済みfreee見積書IDを入力してください。')
  const ref = exportRef(rfqId), current = await ref.get(), saved = current.data() as ExportRecord | undefined
  if (!saved || !['sending', 'uncertain'].includes(saved.status)) throw new HttpsError('failed-precondition', '結果不明の見積のみ照合できます。')
  if (saved.startedAt && Date.now() - saved.startedAt.toMillis() < 120_000) throw new HttpsError('failed-precondition', '送信処理の完了を待っています。2分後に照合してください。')
  const token = await connection(true)
  if (token.companyId !== saved.companyId) throw new HttpsError('failed-precondition', '元の事業所に再接続してください。')
  let result: FreeeResult
  try {
    const response = await fetch(`https://api.freee.co.jp/iv/quotations/${data.quotationId}?company_id=${saved.companyId}`, { headers: { authorization: `Bearer ${token.accessToken}` }, signal: AbortSignal.timeout(25_000), redirect: 'error' })
    if (!response.ok) throw new Error('lookup failed')
    const body: unknown = await response.json(), q = record(record(body).quotation)
    if (q.id !== data.quotationId || q.memo !== saved.marker || q.partner_id !== saved.payload.partner_id) throw new Error('not the same export')
    result = freeeResult(body, saved.payload, saved.preview.total, saved.preview.tax)
  } catch { throw new HttpsError('failed-precondition', 'この送信に対応するfreee見積書を確認できません。事業所・見積書ID・社内メモを確認してください。再作成は停止したままです。') }
  await getFirestore().runTransaction(async transaction => {
    const latest = (await transaction.get(ref)).data() as ExportRecord
    if (latest.digest !== saved.digest || !['sending', 'uncertain'].includes(latest.status)) throw new HttpsError('aborted', '状態が変更されました。再読込してください。')
    transaction.update(ref, { status: 'sent', result, error: '', updatedAt: FieldValue.serverTimestamp() })
    transaction.create(ref.collection('events').doc(), eventData(request.auth!.uid, 'reconciled', saved.revision, { result }))
  })
  return { status: 'sent', result }
})
